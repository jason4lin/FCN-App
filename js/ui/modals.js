import { state } from '../state.js';
import {
  $, $$, uid, localDateStr, parseFloatOrNull, formatSymbol,
  stripSuffix, fmt, escHtml
} from '../utils.js';
import { renderDashboard } from './dashboard.js';
import { saveContracts } from '../api.js';

// ── Modals: 共同邏輯 ──────────────────────────────────────────
export function showModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

export function hideAllModals() {
  $$('.modal-overlay').forEach(el => el.classList.add('hidden'));
}

// ── Modals: 添加 / 編輯合約 ────────────────────────────────────
export function openAddModal() {
  state.editingId = null;
  $('modal-title').textContent = '新建 FCN 合約';
  $('submit-btn').textContent  = '✓ 建立合約';
  $('f-name').value      = '';
  $('f-start').value     = localDateStr(new Date());
  $('f-duration').value  = 12;
  $('f-noop').value      = 0;
  $('f-ko-pct').value    = 100;
  $('f-strike-pct').value= 80;
  $('f-ki-pct').value    = 80;
  $('f-principal').value = '';
  $('f-coupon').value    = '';
  setSettleMonths(1);
  setContractMarket('US');
  setUnderlyingCount(2, true);
  showModal('modal');
}

export function setSettleMonths(m) {
  state.settleMonths = m;
  $('f-settle-months').value = m;
  $$('#settle-selector .multi-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.settle == m);
  });
}

export function setContractMarket(mkt) {
  state.contractMarket = mkt;
  $$('#market-selector .multi-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mkt === mkt);
  });
  if (!state.editingId) {
    const map = { US: { ko:100, st:80, ki:80 }, TW: { ko:100, st:0, ki:80 }, TWO: { ko:100, st:0, ki:80 } };
    const d = map[mkt] || map.US;
    $('f-ko-pct').value = d.ko;
    $('f-strike-pct').value = (mkt === 'TW' || mkt === 'TWO') ? '' : d.st;
    $('f-ki-pct').value = d.ki;
  }
}

export function setUnderlyingCount(n, reset = false, existingData = []) {
  state.underlyingCount = n;
  $$('#count-selector .multi-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.count) === n && b.dataset.count !== 'custom');
    if (b.dataset.count === 'custom') b.classList.remove('active');
  });
  $('count-custom-wrap').classList.add('hidden');

  const container = $('underlyings-container');
  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const data = existingData[i] || {};
    container.insertAdjacentHTML('beforeend', buildUnderlyingBlock(i, data));
    setupUnderlyingEvents(i);
  }
}

function buildUnderlyingBlock(i, data = {}) {
  const rawSym  = data.symbol ? stripSuffix(data.symbol) : '';
  const hasInfo = !!(data.name && data.basePrice);
  const cur     = data.currency || '--';
  const bp      = data.basePrice;

  return `
  <div class="u-block" id="u-block-${i}">
    <div class="u-block-header">
      <span class="u-num">標的 ${i + 1}</span>
    </div>
    <div class="u-search-wrapper">
      <div class="symbol-search-row">
        <input type="text" id="u${i}-symbol" class="field-input"
          value="${escHtml(rawSym)}" placeholder="輸入股票代號，例：NVDA、2330"
          autocomplete="off" spellcheck="false">
        <button type="button" class="btn-search" id="u${i}-search">🔍 查詢</button>
      </div>
      <div class="autocomplete-dropdown hidden" id="u${i}-ac"></div>
    </div>
    <div id="u${i}-error" class="search-error hidden"></div>
    <div class="u-result-row ${hasInfo ? '' : 'hidden'}" id="u${i}-result">
      <span class="u-result-name" id="u${i}-name">${escHtml(data.name || '')}</span>
      <span>
        <span class="u-result-currency" id="u${i}-currency">${cur}</span>
        <span class="u-result-price" id="u${i}-price-disp">${hasInfo ? fmt(bp) : ''}</span>
      </span>
    </div>
    <div class="u-base-label">
      基準股價
      <span class="u-base-currency" id="u${i}-cur-badge">${cur}</span>
    </div>
    <input type="number" id="u${i}-base" class="field-input"
      step="0.01" min="0" value="${bp || ''}" placeholder="查詢後自動填入，也可手動輸入">
  </div>`;
}

function setupUnderlyingEvents(i) {
  const symEl = $(`u${i}-symbol`);
  const btn   = $(`u${i}-search`);

  symEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); fetchQuoteForBlock(i); }
    if (e.key === 'Escape') $(`u${i}-ac`).classList.add('hidden');
  });

  symEl.addEventListener('input', () => {
    clearTimeout(state.acTimers[i]);
    const q = symEl.value.trim();
    if (q.length < 1) { $(`u${i}-ac`).classList.add('hidden'); return; }
    state.acTimers[i] = setTimeout(() => doAutocomplete(i, q), 350);
  });

  btn.addEventListener('click', () => fetchQuoteForBlock(i));
}

async function doAutocomplete(i, query) {
  const ac = $(`u${i}-ac`);
  if (!ac) return;
  try {
    const results = await window.api.searchSymbol(query);
    if (!results.length) { ac.classList.add('hidden'); return; }

    ac.innerHTML = results.map(r => `
      <div class="autocomplete-item" data-sym="${escHtml(r.symbol)}" data-name="${escHtml(r.name)}">
        <span class="ac-symbol">${escHtml(r.symbol)}</span>
        <span class="ac-name">${escHtml(r.name)}</span>
      </div>`).join('');

    ac.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        $(`u${i}-symbol`).value = stripSuffix(item.dataset.sym);
        ac.classList.add('hidden');
        fetchQuoteForBlock(i);
      });
    });
    ac.classList.remove('hidden');
  } catch { ac.classList.add('hidden'); }
}

async function fetchQuoteForBlock(i) {
  const rawSym = $(`u${i}-symbol`)?.value.trim();
  if (!rawSym) return;

  const symbol  = formatSymbol(rawSym, state.contractMarket);
  const btn     = $(`u${i}-search`);
  const errEl   = $(`u${i}-error`);
  const origTxt = btn.textContent;

  errEl.classList.add('hidden');
  btn.textContent = '⏳';
  btn.disabled    = true;
  $(`u${i}-ac`).classList.add('hidden');

  try {
    // 取得最新報價與基本資訊（名稱、幣別）
    const res = await window.api.fetchQuote(symbol);
    const stDate = $('f-start').value;
    const isToday = stDate === localDateStr(new Date());

    if (res.ok) {
      const cur = res.currency || '--';
      let dispPrice = res.price;
      let isHistLabel = false;

      // 如果成立日期不是今天，同時抓取歷史收盤價
      if (!isToday && stDate) {
        try {
          const hist = await window.api.fetchHistPrices({ symbols: [symbol], date: stDate });
          if (hist[symbol] && hist[symbol].ok && hist[symbol].price != null) {
            dispPrice = hist[symbol].price;
            isHistLabel = true;
          }
        } catch (e) { console.warn('fetch historical failed, fallback to live quote', e); }
      }

      if (dispPrice != null) {
        $(`u${i}-base`).value              = dispPrice.toFixed(2);
        $(`u${i}-name`).textContent        = res.name;
        $(`u${i}-price-disp`).textContent  = fmt(dispPrice) + (isHistLabel ? ' (歷史)' : '');
        $(`u${i}-currency`).textContent    = cur;
        $(`u${i}-cur-badge`).textContent   = cur;
        $(`u${i}-result`).classList.remove('hidden');
      } else {
        showFieldError(i, `無法取得價格。`);
      }
    } else {
      showFieldError(i, `找不到「${symbol}」，請確認代號格式。（${res.message || ''}）`);
    }
  } catch (err) {
    showFieldError(i, '查詢失敗，請確認網路連線後重試');
    console.error(err);
  } finally {
    btn.textContent = origTxt;
    btn.disabled    = false;
  }
}

function showFieldError(i, msg) {
  const el = $(`u${i}-error`);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

export function openEditModal(id) {
  const c = state.contracts.find(x => x.id === id);
  if (!c) return;
  state.editingId = id;
  $('modal-title').textContent = '編輯 FCN 合約';
  $('submit-btn').textContent  = '✓ 儲存修改';

  $('f-name').value      = c.name || '';
  $('f-start').value     = c.startDate || '';
  $('f-duration').value  = c.durationMonths || 12;
  $('f-noop').value      = c.noopMonths || 0;
  $('f-ko-pct').value    = c.koPercent || '';
  $('f-strike-pct').value= c.strikePercent || '';
  $('f-ki-pct').value    = c.kiPercent || '';
  $('f-principal').value = c.principal || '';
  $('f-coupon').value    = c.couponPercent || '';

  setSettleMonths(c.settlementMonths || 1);
  setContractMarket(c.market || 'US');
  setUnderlyingCount(c.underlyings?.length || 2, false, c.underlyings);
  showModal('modal');
}

export async function onContractFormSubmit(e) {
  e.preventDefault();
  const arr = [];
  const mkt = state.contractMarket;
  for (let i = 0; i < state.underlyingCount; i++) {
    const raw = $(`u${i}-symbol`).value.trim();
    if (!raw) continue;
    const baseP = parseFloat($(`u${i}-base`).value);
    if (isNaN(baseP) || baseP <= 0) {
      alert(`請確認「標的 ${i+1}」輸入了有效的基準價`);
      return;
    }
    arr.push({
      symbol:    formatSymbol(raw, mkt),
      name:      $(`u${i}-name`).textContent.trim() || raw,
      basePrice: baseP,
      currency:  $(`u${i}-currency`).textContent.trim() || '--',
    });
  }

  if (arr.length === 0) { alert('至少需輸入一檔有效標的與基準價。'); return; }

  const newC = {
    id:              state.editingId || uid(),
    name:            $('f-name').value.trim() || null,
    market:          mkt,
    startDate:       $('f-start').value,
    durationMonths:  parseInt($('f-duration').value, 10),
    noopMonths:      parseInt($('f-noop').value, 10) || 0,
    settlementMonths: parseInt($('f-settle-months').value, 10) || 1,
    koPercent:       parseFloatOrNull($('f-ko-pct').value),
    strikePercent:   parseFloatOrNull($('f-strike-pct').value),
    kiPercent:       parseFloatOrNull($('f-ki-pct').value),
    principal:       parseFloatOrNull($('f-principal').value),
    couponPercent:   parseFloatOrNull($('f-coupon').value),
    underlyings:     arr,
    createdAt:       Date.now(),
  };

  if (state.editingId) {
    const idx = state.contracts.findIndex(x => x.id === state.editingId);
    if (idx >= 0) {
      const old = state.contracts[idx];
      // 判斷影響觀察日期的欄位是否有變動
      const scheduleChanged =
        old.startDate        !== newC.startDate        ||
        old.durationMonths   !== newC.durationMonths   ||
        old.settlementMonths !== newC.settlementMonths ||
        old.noopMonths       !== newC.noopMonths;

      if (scheduleChanged) {
        // 清除舊觀察日 cache、自動判定通知、及已結單狀態（日期已失效）
        Object.keys(state.histCache).forEach(k => {
          if (k.startsWith(`${state.editingId}__`)) delete state.histCache[k];
        });
        delete state.autoProcessedNotices[state.editingId];
        // redeemedDate / assignment / frozenPrices 不繼承（觀察日已變動）
      } else {
        // 日期結構沒變，保留結單狀態與凍結報價
        newC.redeemedDate = old.redeemedDate;
        newC.assignment   = old.assignment;
        newC.frozenPrices = old.frozenPrices;
      }
      state.contracts[idx] = newC;
    }
  } else {
    state.contracts.push(newC);
  }

  hideAllModals();
  await saveContracts();

  // 立即拉取新標的報價
  try {
    const prices = await window.api.fetchPrices(arr.map(u => u.symbol));
    Object.assign(state.livePrices, prices);
  } catch(err) { console.error(err); }
  renderDashboard();
}

// ── Modals: 接盤記錄 ──────────────────────────────────────────
export function openAssignmentModal(id) {
  const c = state.contracts.find(x => x.id === id);
  if (!c) return;
  state.editingId = id;
  const sel = $('a-symbol');
  sel.innerHTML = '';
  c.underlyings?.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.symbol;
    opt.textContent = `${stripSuffix(u.symbol)} (${u.name || ''})`;
    sel.appendChild(opt);
  });
  if (c.assignment) {
    $('a-date').value   = c.assignment.date;
    sel.value           = c.assignment.symbol;
    $('a-shares').value = c.assignment.shares || '';
    $('a-price').value  = c.assignment.actualPrice || '';
    $('assign-clear-btn').style.display = 'block';
  } else {
    $('a-date').value   = localDateStr(new Date());
    if (sel.options.length > 0) sel.selectedIndex = 0;
    $('a-shares').value = '';
    $('a-price').value  = '';
    $('assign-clear-btn').style.display = 'none';
  }
  showModal('assign-modal');
}

export async function onAssignFormSubmit(e) {
  e.preventDefault();
  const idx = state.contracts.findIndex(x => x.id === state.editingId);
  if (idx < 0) return;
  const aDate   = $('a-date').value;
  const aSymbol = $('a-symbol').value;
  const aShares = parseFloatOrNull($('a-shares').value);
  const aPrice  = parseFloatOrNull($('a-price').value);

  if (!aDate || !aSymbol || !aShares || !aPrice) {
    alert('請填寫完整接盤資訊 (日期/標的/股數/實際價)。');
    return;
  }
  state.contracts[idx].assignment   = { date: aDate, symbol: aSymbol, shares: aShares, actualPrice: aPrice };
  state.contracts[idx].redeemedDate = null;

  hideAllModals();
  await saveContracts();
  renderDashboard();
}

export async function clearAssignment() {
  const idx = state.contracts.findIndex(x => x.id === state.editingId);
  if (idx >= 0) {
    state.contracts[idx].assignment = null;
    hideAllModals();
    await saveContracts();
    renderDashboard();
  }
}

