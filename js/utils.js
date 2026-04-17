/**
 * 工具函式集 (Utils)
 * 純函數，無副作用，負責格式化和日期計算等。
 */

const SETTLE_LABELS = { 1:'每月', 2:'每2月', 3:'每季', 6:'每半年', 12:'每年' };
const MKT_BADGE = { US: '🇺🇸', TW: '🇹🇼', TWO: '🏷️' };

export const $  = (id) => document.getElementById(id);
export const $$ = (sel) => document.querySelectorAll(sel);

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

export function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '--';
  return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtMoney(n, currency = '') {
  if (n == null || isNaN(n)) return '--';
  return Number(n).toLocaleString('zh-TW') + (currency ? ' ' + currency : '');
}

export function formatSymbol(raw, market) {
  const s = raw.trim().toUpperCase();
  if (s.includes('.')) return s;
  if (market === 'TW')  return `${s}.TW`;
  if (market === 'TWO') return `${s}.TWO`;
  return s;
}

export function stripSuffix(sym) {
  return sym.replace(/\.(TW|TWO)$/i, '');
}

export function parseFloatOrNull(v) {
  const n = parseFloat(v);
  return (!isNaN(n) && n > 0) ? n : null;
}

export function daysUntil(isoDate) {
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((new Date(isoDate + 'T00:00:00') - today) / 86400000);
}

export function localDateStr(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function contractEndIso(c) {
  if (!c.startDate || !c.durationMonths) return null;
  const d = new Date(c.startDate + 'T00:00:00');
  d.setMonth(d.getMonth() + Number(c.durationMonths));
  return localDateStr(d);
}

export function settlementLabel(months) {
  return SETTLE_LABELS[months] || `每${months}月`;
}

/** 市場狀態 badge */
export function mktStateBadge(marketState) {
  if (!marketState) return '';
  const map = {
    REGULAR:    { label: '盤中', cls: 'mkt-open'   },
    PRE:        { label: '盤前', cls: 'mkt-pre'    },
    POST:       { label: '盤後', cls: 'mkt-post'   },
    POSTPOST:   { label: '盤後', cls: 'mkt-post'   },
    PREPRE:     { label: '盤前', cls: 'mkt-pre'    },
    CLOSED:     { label: '已收盤 ✔', cls: 'mkt-closed' },
  };
  const m = map[marketState] || { label: marketState, cls: 'mkt-closed' };
  return `<span class="mkt-state ${m.cls}">${m.label}</span>`;
}

/** 計算觀察日清單 */
export function calcSchedule(c) {
  if (!c.startDate || !c.durationMonths) return { observationDates: [], endDate: null };
  const sm    = Number(c.settlementMonths || 1);
  const noop  = Number(c.noopMonths || 0);
  const dur   = Number(c.durationMonths);
  const start = new Date(c.startDate + 'T00:00:00');
  const end   = new Date(start); end.setMonth(end.getMonth() + dur);
  const dates = [];
  const cur   = new Date(start); cur.setMonth(cur.getMonth() + sm);
  while (cur <= end) {
    dates.push(localDateStr(cur));
    cur.setMonth(cur.getMonth() + sm);
  }
  const endIso = localDateStr(end);
  if (!dates.length || dates[dates.length - 1] !== endIso) dates.push(endIso);
  return { observationDates: dates, endDate: endIso };
}

export function getNextObservation(c) {
  const today = localDateStr(new Date());
  return calcSchedule(c).observationDates.find(d => d >= today) || null;
}

export function noopEndIso(c) {
  if (!c.startDate || !c.noopMonths || Number(c.noopMonths) === 0) return null;
  const d = new Date(c.startDate + 'T00:00:00');
  d.setMonth(d.getMonth() + Number(c.noopMonths));
  return localDateStr(d);
}

/** 取得尚未確認的過去觀察日 */
export function getUncheckedObsDates(c) {
  if (c.redeemedDate || c.assignment) return [];
  const today = localDateStr(new Date());
  return calcSchedule(c).observationDates.filter(d => d < today);
}

/** 取得合約實際結束日 */
export function getEffectiveEndDate(c) {
  if (c.redeemedDate) return c.redeemedDate;
  if (c.assignment?.date) return c.assignment.date;
  return contractEndIso(c);
}

/** 判斷是否已結束 */
export function isEnded(c) {
  const endIso = contractEndIso(c);
  if (c.redeemedDate) {
    if (endIso && c.redeemedDate >= endIso) return true; // 正常到期
    return true; // KO 提前贖回
  }
  if (c.assignment) return true; // 已接盤
  if (endIso && endIso < localDateStr(new Date())) return true; // 自然過期
  return false;
}

export function contractStatus(c) {
  if (c.assignment) return 'assigned';
  const endIso = contractEndIso(c);
  if (c.redeemedDate) {
    if (endIso && c.redeemedDate >= endIso) return 'ended';
    return 'redeemed';
  }
  if (endIso && endIso < localDateStr(new Date())) return 'ended';
  return 'active';
}

/** 取得合約的基準貨幣（依第一個標的） */
export function contractCurrency(c) {
  if (!c.underlyings || !c.underlyings.length) return '';
  return c.underlyings[0].currency || '';
}

/** 計算接盤時的帳面虧損 */
export function calcAssignmentUnrealizedLoss(c, a) {
  if (!c.strikePercent || !a.actualPrice || !a.shares) return null;
  const u = (c.underlyings || []).find(x => x.symbol === a.symbol);
  if (!u || !u.basePrice) return null;
  const strike = u.basePrice * c.strikePercent / 100;
  const diffPerShare = a.actualPrice - strike;
  return diffPerShare * a.shares; 
}

/** 計算每期配息（年化利率 ÷ 每年期數） */
export function calcPerPeriodCoupon(c) {
  if (!c.principal || !c.couponPercent || !c.settlementMonths) return null;
  const annualRate = c.couponPercent / 100;
  const periodsPerYear = 12 / Number(c.settlementMonths);
  return c.principal * annualRate / periodsPerYear;
}

/** 計算配息總額（已過觀察日的完整期數 + 提前 KO 的零頭天數利息） */
export function calcAccruedCoupon(c) {
  if (!c.principal || !c.couponPercent || !c.settlementMonths || !c.startDate) return null;
  const today = localDateStr(new Date());
  const effectiveEnd = getEffectiveEndDate(c);
  const cutoff = effectiveEnd && effectiveEnd < today ? effectiveEnd : today;
  const { observationDates } = calcSchedule(c);

  let count = 0;
  for (const d of observationDates) {
    if (d <= cutoff) count++;
    else break;
  }

  const perPeriod = calcPerPeriodCoupon(c);
  let total = perPeriod * count;

  // 提前 KO：加計上次觀察日到 KO 日的零頭天數利息
  const naturalEnd = contractEndIso(c);
  const isEarlyKO = c.redeemedDate && naturalEnd && c.redeemedDate < naturalEnd;
  if (isEarlyKO) {
    const prevObs = [...observationDates].filter(d => d <= c.redeemedDate).pop();
    if (prevObs && prevObs !== c.redeemedDate) {
      const days = Math.round(
        (new Date(c.redeemedDate + 'T00:00:00') - new Date(prevObs + 'T00:00:00')) / 86400000
      );
      total += Math.round(c.principal * (c.couponPercent / 100) * days / 365 * 100) / 100;
    }
  }

  return total || 0;
}

export { MKT_BADGE, SETTLE_LABELS };

// ══ CSV 匯出 / 匯入 ═══════════════════════════════════════════════════════════

function csvEsc(s) {
  const str = String(s ?? '');
  return (str.includes(',') || str.includes('"') || str.includes('\n'))
    ? '"' + str.replace(/"/g, '""') + '"' : str;
}

export function contractsToCSV(contracts) {
  const headers = [
    '合約ID','合約名稱','開始日期','時長(月)','不比價(月)','結算頻率(月)',
    '市場','KO%','Strike%','KI%','投入本金','年化票息率%','已贖回日期','建立時間',
    '標的序號','標的代號','標的名稱','基準價','貨幣',
    '接盤標的','接盤日期','接盤股數','實際接盤價',
  ];
  const rows = [headers.join(',')];
  contracts.forEach(c => {
    const a = c.assignment;
    const base = [
      csvEsc(c.id), csvEsc(c.name || ''), c.startDate || '',
      c.durationMonths || '', c.noopMonths || 0, c.settlementMonths || 1,
      c.market || 'US', c.koPercent || '', c.strikePercent || '', c.kiPercent || '',
      c.principal || '', c.couponPercent || '', c.redeemedDate || '', c.createdAt || '',
    ];
    const assign = [
      a ? csvEsc(a.symbol || '') : '', a ? (a.date || '') : '',
      a ? (a.shares || '') : '', a ? (a.actualPrice || '') : '',
    ];
    (c.underlyings || []).forEach((u, i) => {
      rows.push([
        ...base, i, csvEsc(u.symbol || ''), csvEsc(u.name || ''),
        u.basePrice || '', csvEsc(u.currency || ''), ...assign,
      ].join(','));
    });
  });
  return rows.join('\r\n');
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

export function csvToContracts(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;
  const headers = parseCSVLine(lines[0]);
  const col = {};
  headers.forEach((h, i) => { col[h.trim()] = i; });
  if (col['合約ID'] === undefined || col['標的代號'] === undefined) return null;

  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    const id = c[col['合約ID']]?.trim();
    if (!id) continue;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name:            c[col['合約名稱']]?.trim()    || null,
        startDate:       c[col['開始日期']]?.trim()    || '',
        durationMonths:  parseInt(c[col['時長(月)']]   || '12') || 12,
        noopMonths:      parseInt(c[col['不比價(月)']] || '0')  || 0,
        settlementMonths: parseInt(c[col['結算頻率(月)']] || '1') || 1,
        market:          c[col['市場']]?.trim()        || 'US',
        koPercent:       parseFloatOrNull(c[col['KO%']]     || ''),
        strikePercent:   parseFloatOrNull(c[col['Strike%']] || ''),
        kiPercent:       parseFloatOrNull(c[col['KI%']]     || ''),
        principal:       parseFloatOrNull(c[col['投入本金']] || ''),
        couponPercent:   parseFloatOrNull(c[col['年化票息率%']] || ''),
        redeemedDate:    c[col['已贖回日期']]?.trim()  || null,
        createdAt:       parseInt(c[col['建立時間']]   || '0') || Date.now(),
        underlyings: [], assignment: null,
      });
    }
    const contract = map.get(id);
    const sym = c[col['標的代號']]?.trim();
    if (sym) {
      contract.underlyings.push({
        symbol:    sym,
        name:      c[col['標的名稱']]?.trim() || '',
        basePrice: parseFloatOrNull(c[col['基準價']] || '') || null,
        currency:  c[col['貨幣']]?.trim()     || 'USD',
      });
    }
    if (!contract.assignment) {
      const aSym   = c[col['接盤標的']]?.trim();
      const aDate  = c[col['接盤日期']]?.trim();
      const aShares = parseFloatOrNull(c[col['接盤股數']]   || '');
      const aPrice  = parseFloatOrNull(c[col['實際接盤價']] || '');
      if (aSym && aDate && aShares && aPrice)
        contract.assignment = { symbol: aSym, date: aDate, shares: aShares, actualPrice: aPrice };
    }
  }
  return [...map.values()].filter(x => x.underlyings.length > 0);
}
