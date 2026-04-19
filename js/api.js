import { state, migrateContracts } from './state.js';
import { renderDashboard, updatePendingIndicator, setStatusText } from './ui/dashboard.js';
import { isEnded, getUncheckedObsDates, contractEndIso, localDateStr, calcSchedule, noopEndIso } from './utils.js';

export async function loadContracts() {
  const raw = await window.api.getContracts();
  state.contracts = migrateContracts(raw);
}

export async function saveContracts() {
  await window.api.saveContracts(state.contracts);
}

/** Phase 1：查詢所有標的即時報價 */
export async function refreshPrices() {
  const symbolSet = new Set();
  state.contracts.forEach(c => {
    if (isEnded(c) && c.frozenPrices) return; // 已結單且有凍結價格，不再更新
    c.underlyings?.forEach(u => u.symbol && symbolSet.add(u.symbol));
  });
  const symbols = [...symbolSet];
  if (symbols.length === 0) return;

  setStatusText(`[1/2] 正在更新即時報價（${symbols.length} 個標的）…`);
  try {
    const results = await window.api.fetchPrices(symbols);
    Object.assign(state.livePrices, results);
    state.lastRefreshDate = localDateStr(new Date());
    renderDashboard();
    
    const now = new Date();
    document.getElementById('last-update').textContent = `最後更新\n${now.toLocaleDateString('zh-TW')} ${now.toLocaleTimeString('zh-TW')}`;
    updatePendingIndicator();
  } catch (err) {
    console.error('[refreshPrices]', err);
  }
}

/** Phase 2：查詢所有未確認觀察日歷史收盤價 */
export async function runHistCheckAll() {
  const toFetch = [];
  const today = localDateStr(new Date());
  state.contracts.forEach(c => {
    const symbols = (c.underlyings || []).map(u => u.symbol);
    const endIso  = contractEndIso(c);

    let dates;
    if (c.redeemedDate || c.assignment) {
      // 已結算合約：仍抓歷史資料供 hist banner 顯示，只取到實際結束日為止
      const effectiveEnd = c.redeemedDate || c.assignment?.date || endIso;
      dates = calcSchedule(c).observationDates.filter(d => d <= today && (!effectiveEnd || d <= effectiveEnd));
    } else {
      dates = getUncheckedObsDates(c);
    }

    dates.forEach(date => {
      const key = `${c.id}__${date}`;
      if (!state.histCache[key]) toFetch.push({ c, date, symbols, endIso, key });
    });
  });
  if (!toFetch.length) return;

  setStatusText(`[2/2] 正在查詢歷史觀察日（${toFetch.length} 筆）…`);

  await Promise.allSettled(toFetch.map(async ({ c, date, symbols, endIso, key }) => {
    try {
      const prices = await window.api.fetchHistPrices({ symbols, date });
      let koAllAbove = !!(c.underlyings?.length);
      let hasKI = false, anyError = false;
      (c.underlyings || []).forEach(u => {
        const p = prices[u.symbol];
        if (!p?.ok || p.price == null) { koAllAbove = false; anyError = true; return; }
        const koPrice = c.koPercent ? u.basePrice * c.koPercent / 100 : null;
        const kiPrice = c.kiPercent ? u.basePrice * c.kiPercent / 100 : null;
        if (koPrice != null && p.price < koPrice) koAllAbove = false;
        if (kiPrice != null && p.price <= kiPrice) hasKI = true;
      });
      state.histCache[key] = { prices, koAllAbove, hasKI, anyError, isEnd: date === endIso };
    } catch (e) {
      state.histCache[key] = { error: true };
    }
  }));
  renderDashboard();
}

/**
 * 自動判定單一合約狀態並寫回 state.contracts
 * 回傳 notice 物件（供 banner 顯示），若無需處理回傳 null
 */
function applyAutoProcess(id) {
  const idx = state.contracts.findIndex(x => x.id === id);
  if (idx < 0) return null;
  const c = state.contracts[idx];

  const endIso = contractEndIso(c);
  const { observationDates } = calcSchedule(c);
  const today = localDateStr(new Date());
  const pastDates = observationDates.filter(d => d <= today);
  const noopEnd = noopEndIso(c);
  let everKI = false;

  for (const d of pastDates) {
    const h = state.histCache[`${c.id}__${d}`];
    if (!h || h.error) continue;

    const inNoop = noopEnd && d <= noopEnd;

    // ① KO（普通模式）：不比價期間外，全部超過 KO 門檻 → 提前贖回
    // 記憶式 KO 由 runKOMemoryCheck 獨立處理，這裡跳過
    if (!state.settings?.memoryKO && !inNoop && h.koAllAbove) {
      state.contracts[idx].redeemedDate  = d;
      state.contracts[idx].assignment    = null;
      state.contracts[idx].frozenPrices  = h.prices || null;
      return { type: 'ko', date: d };
    }

    // ② EKI：只記旗標，不立即結算——到期日才判斷
    if (h.hasKI) everKI = true;
  }

  // ③ 到期日已過 → 判斷最終結算方式
  if (endIso && pastDates.includes(endIso)) {
    const endH = state.histCache[`${c.id}__${endIso}`];

    // 情境 C：曾觸及 EKI 且到期日最差標的仍低於 EKI 價 → 接盤（Strike）
    if (everKI && endH && !endH.error && endH.prices && c.strikePercent && c.kiPercent) {
      const lowestU = (c.underlyings || []).reduce((best, u) => {
        const p = endH.prices[u.symbol];
        if (!p?.ok || p.price == null) return best;
        const ratio = p.price / u.basePrice;
        return (!best || ratio < best.ratio) ? { u, ratio } : best;
      }, null);

      if (lowestU) {
        const kiPrice    = lowestU.u.basePrice * c.kiPercent    / 100;
        const strikePrice = lowestU.u.basePrice * c.strikePercent / 100;
        const endPrice    = endH.prices[lowestU.u.symbol];

        if (endPrice?.price < kiPrice) {
          const shares = c.principal
            ? Math.round(c.principal / strikePrice * 100000) / 100000
            : null;
          state.contracts[idx].assignment = {
            date: endIso, symbol: lowestU.u.symbol,
            shares, actualPrice: strikePrice, autoCalculated: true,
          };
          state.contracts[idx].redeemedDate = null;
          state.contracts[idx].frozenPrices = endH.prices || null;
          return { type: 'ki_assigned', date: endIso, symbol: lowestU.u.symbol, shares, strikePrice };
        }
      }
    }

    // 情境 A/B：從未觸及 EKI，或 EKI 後到期日已漲回 → 自然到期
    state.contracts[idx].redeemedDate  = endIso;
    state.contracts[idx].assignment    = null;
    state.contracts[idx].frozenPrices  = endH?.prices || null;
    return { type: 'natural', date: endIso };
  }

  return null; // 到期日未到，不處理
}

/** 自動判定所有可結算的合約（histCache 完整才觸發） */
export async function autoProcessContracts() {
  let anyChanged = false;

  for (const c of state.contracts) {
    if (c.redeemedDate || c.assignment) continue; // 已正式結單，略過
    const unchecked = getUncheckedObsDates(c);
    if (unchecked.length === 0) continue;

    // 所有未確認日期都必須有 histCache（允許 anyError，不允許完全缺失）
    const allReady = unchecked.every(d => !!state.histCache[`${c.id}__${d}`]);
    if (!allReady) continue;

    const notice = applyAutoProcess(c.id);
    if (notice) {
      state.autoProcessedNotices[c.id] = notice;
      anyChanged = true;
    }
  }

  if (anyChanged) {
    await saveContracts();
    renderDashboard();
  }
}

/** 載入設定 */
export async function loadSettings() {
  const saved = await window.api.getSettings();
  Object.assign(state.settings, saved);
  const checkbox = document.getElementById('memory-ko-toggle');
  if (checkbox) checkbox.checked = !!state.settings.memoryKO;
  const autoStartToggle = document.getElementById('auto-start-toggle');
  if (autoStartToggle) autoStartToggle.checked = !!state.settings.autoStartDate;
}

/** 記憶式 KO：各標的獨立記憶，全部達標後才終止 */
export async function runKOMemoryCheck() {
  if (!state.settings?.memoryKO) return;

  const today = localDateStr(new Date());
  let anyChanged = false;

  for (const c of state.contracts) {
    if (c.redeemedDate || c.assignment) continue;
    if (!c.koPercent || !c.startDate || !c.durationMonths) continue;

    const underlyings = (c.underlyings || []).filter(u => u.symbol && u.basePrice);
    if (!underlyings.length) continue;

    const endIso  = contractEndIso(c);
    const fetchEnd = (endIso && endIso < today) ? endIso : today;
    const noopEnd  = noopEndIso(c);

    if (!state.koMemory[c.id]) state.koMemory[c.id] = {};
    const memories = state.koMemory[c.id];

    for (const u of underlyings) {
      if (memories[u.symbol]) continue; // already remembered

      const result = await window.api.fetchPriceRange({
        symbol: u.symbol, startDate: c.startDate, endDate: fetchEnd,
      });
      if (!result?.ok || !result.quotes?.length) continue;

      const koPrice  = u.basePrice * c.koPercent / 100;
      const hitQuote = result.quotes.find(q => {
        if (noopEnd && q.date <= noopEnd) return false;
        return q.price >= koPrice;
      });
      if (hitQuote) memories[u.symbol] = hitQuote.date;
    }

    // 全部標的都被記憶 → 終止日 = 最晚記憶日
    const allRemembered = underlyings.every(u => memories[u.symbol]);
    if (allRemembered) {
      const terminateDate = underlyings.reduce((latest, u) => {
        const d = memories[u.symbol];
        return (!latest || d > latest) ? d : latest;
      }, null);

      const idx = state.contracts.findIndex(x => x.id === c.id);
      const termH = state.histCache[`${c.id}__${terminateDate}`];
      state.contracts[idx].redeemedDate = terminateDate;
      state.contracts[idx].assignment   = null;
      state.contracts[idx].frozenPrices = termH?.prices || null;
      state.autoProcessedNotices[c.id]  = { type: 'ko', date: terminateDate };
      anyChanged = true;
    }
  }

  if (anyChanged) {
    await saveContracts();
    renderDashboard();
  }
}

/** 全部更新：即時報價 → 歷史觀察日確認 */
export async function refreshAll() {
  if (state.contracts.length === 0) return;
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  document.getElementById('status-bar').classList.remove('hidden');
  document.getElementById('refresh-icon').style.animation = 'spin .8s linear infinite';
  try {
    await refreshPrices();
    await runHistCheckAll();
    await runKOMemoryCheck();
    await autoProcessContracts();
  } finally {
    btn.disabled = false;
    document.getElementById('refresh-icon').style.animation = '';
    document.getElementById('status-bar').classList.add('hidden');
    updatePendingIndicator();
  }
}
