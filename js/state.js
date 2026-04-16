/**
 * 集中管理全域狀態
 */

export const state = {
  contracts: [],
  livePrices: {},
  histCache: {}, // { "[id]__[date]": { prices, koAllAbove, hasKI, anyError, isEnd } }
  lastRefreshDate: '',

  // 自動判定後的通知（key=合約id，value={ type, date, ... }）
  autoProcessedNotices: {},

  // UI State
  editingId: null,
  deletingId: null,
  underlyingCount: 2,
  contractMarket: 'US',
  settleMonths: 1,
  currentView: 'all', // 'all' | 'active' | 'ended'
  sortMode: 'urgency', // 'urgency' | 'next_obs' | 'date'
  sortDir:  'desc',    // 'asc' | 'desc'
  filterFrom: '',
  filterTo: '',
  acTimers: {}
};

/** 從 IPC 返回的舊資料轉移到新結構 */
export function migrateContracts(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(c => {
    if (c.underlyings && Array.isArray(c.underlyings)) {
      return c; 
    }
    const underlyings = [];
    if (c.symbol1) underlyings.push({ symbol: c.symbol1, name: c.name1||'', basePrice: c.base1||0, currency: c.currency1||'' });
    if (c.symbol2) underlyings.push({ symbol: c.symbol2, name: c.name2||'', basePrice: c.base2||0, currency: c.currency2||'' });
    if (c.symbol3) underlyings.push({ symbol: c.symbol3, name: c.name3||'', basePrice: c.base3||0, currency: c.currency3||'' });
    
    const today = new Date().toISOString().slice(0, 10);
    const redeemedDate = c.redeemedDate || null;
    return {
      id: c.id,
      name: c.name || '',
      market: c.market || 'US',
      startDate: c.startDate || '',
      durationMonths: c.durationMonths || 12,
      settlementMonths: c.settlementMonths || 1,
      noopMonths: c.noopMonths || 0,
      koPercent: c.koPercent || null,
      strikePercent: c.strikePercent || null,
      kiPercent: c.kiPercent || null,
      principal: c.principal || null,
      couponPercent: c.couponPercent || null,
      underlyings: underlyings,
      // 防止未來日期被誤存為 redeemedDate
      redeemedDate: (redeemedDate && redeemedDate <= today) ? redeemedDate : null,
      assignment: c.assignment || null,
      createdAt: c.createdAt || Date.now(),
    };
  }).filter(Boolean);
}
