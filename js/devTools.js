/**
 * 開發測試工具 — 僅供測試用途
 * 在 Electron DevTools console 執行：window.devTools.loadTestScenarios()
 * 執行後會用測試資料取代目前所有合約，並填入 mock histCache。
 */

import { state } from './state.js';
import { renderDashboard } from './ui/dashboard.js';
import { saveContracts, autoProcessContracts } from './api.js';

// ─── 測試合約定義 ──────────────────────────────────────────────────────────────
// 今天：2026-04-16

const TEST_CONTRACTS = [

  // ── A: KO 在第 3 個月（月結算）────────────────────────────────────────────
  // 2025-11-15 起，月觀察，第 1、2 月正常，第 3 月（2026-02-15）全部超過 KO
  // 預期行為：confirmPastObs → redeemedDate = 2026-02-15
  {
    id: 'test-ko-003',
    name: '測試A：KO 提前贖回（第3月）',
    market: 'US',
    startDate: '2025-11-15',
    durationMonths: 12,
    noopMonths: 0,
    settlementMonths: 1,
    koPercent: 100,
    strikePercent: 75,
    kiPercent: 75,
    principal: 500000,
    couponPercent: 18,
    underlyings: [
      { symbol: 'AAPL', name: 'Apple Inc.', basePrice: 226, currency: 'USD' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', basePrice: 408, currency: 'USD' },
    ],
    redeemedDate: null,
    assignment: null,
    createdAt: Date.now(),
  },

  // ── B: KI 在第 2 個月，立即接盤 ────────────────────────────────────────
  // 2025-10-15 起 6 個月，第 2 月（2025-12-15）GOOG 跌破 KI
  // 預期行為：autoProcess → assignment（GOOG, 2025-12-15, Strike 109.2）
  {
    id: 'test-ki-eki-006',
    name: '測試B：KI 觸發 → 到期接盤 (EKI)',
    market: 'US',
    startDate: '2025-10-15',
    durationMonths: 6,
    noopMonths: 0,
    settlementMonths: 1,
    koPercent: 105,
    strikePercent: 65,
    kiPercent: 70,
    principal: 300000,
    couponPercent: 15,
    underlyings: [
      { symbol: 'GOOG', name: 'Alphabet Inc.', basePrice: 168, currency: 'USD' },
      { symbol: 'AMD',  name: 'Advanced Micro Devices', basePrice: 120, currency: 'USD' },
    ],
    redeemedDate: null,
    assignment: null,
    createdAt: Date.now(),
  },

  // ── C: 進行中合約，第 2 月有 KI，立即接盤 ───────────────────────────────
  // 2025-12-15 起 12 個月，第 2 月（2026-02-15）TSLA 跌破 KI
  // 預期行為：autoProcess → 立即接盤（TSLA, 2026-02-15）
  {
    id: 'test-active-ki-009',
    name: '測試C：進行中 + 第2月KI（待勾稽）',
    market: 'US',
    startDate: '2025-12-15',
    durationMonths: 12,
    noopMonths: 0,
    settlementMonths: 1,
    koPercent: 105,
    strikePercent: 75,
    kiPercent: 75,
    principal: 1000000,
    couponPercent: 20,
    underlyings: [
      { symbol: 'TSLA', name: 'Tesla Inc.', basePrice: 350, currency: 'USD' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', basePrice: 128, currency: 'USD' },
    ],
    redeemedDate: null,
    assignment: null,
    createdAt: Date.now(),
  },

  // ── D: 不比價 2 個月，第 3 個月觀察日剛過（昨天）────────────────────────
  // 2026-01-15 起，不比價 2 個月，月觀察
  // 觀察日：2026-02-15（不比價），2026-03-15（不比價），2026-04-15（昨天，可比較）
  // 即使 2026-03-15 兩股都在 KO 以上，也因不比價不觸發
  {
    id: 'test-noop-002',
    name: '測試D：不比價2個月 + 首觀察日昨天',
    market: 'US',
    startDate: '2026-01-15',
    durationMonths: 12,
    noopMonths: 2,
    settlementMonths: 1,
    koPercent: 100,
    strikePercent: 80,
    kiPercent: 80,
    principal: 200000,
    couponPercent: 12,
    underlyings: [
      { symbol: 'AMZN', name: 'Amazon.com Inc.', basePrice: 198, currency: 'USD' },
      { symbol: 'META', name: 'Meta Platforms Inc.', basePrice: 590, currency: 'USD' },
    ],
    redeemedDate: null,
    assignment: null,
    createdAt: Date.now(),
  },
];

// ─── Mock histCache ───────────────────────────────────────────────────────────

function buildMockHistCache(contracts) {
  const cache = {};

  // ── 情境 A：KO 第3月 ───────────────────────────────────────────────────────
  const a = contracts.find(c => c.id === 'test-ko-003');
  if (a) {
    // Month 1: 2025-12-15 AAPL=220(<KO226), MSFT=405(<KO408) → 正常
    cache[`${a.id}__2025-12-15`] = {
      prices: {
        'AAPL': { ok: true, price: 220, currency: 'USD' },
        'MSFT': { ok: true, price: 405, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 2: 2026-01-15 AAPL=218, MSFT=412 → AAPL<KO → 正常
    cache[`${a.id}__2026-01-15`] = {
      prices: {
        'AAPL': { ok: true, price: 218, currency: 'USD' },
        'MSFT': { ok: true, price: 412, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 3: 2026-02-15 AAPL=230(>KO226), MSFT=415(>KO408) → KO!
    cache[`${a.id}__2026-02-15`] = {
      prices: {
        'AAPL': { ok: true, price: 230, currency: 'USD' },
        'MSFT': { ok: true, price: 415, currency: 'USD' },
      },
      koAllAbove: true, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 4: 2026-03-15 — 不應到達（KO 已在 02-15 觸發）
    cache[`${a.id}__2026-03-15`] = {
      prices: {
        'AAPL': { ok: true, price: 232, currency: 'USD' },
        'MSFT': { ok: true, price: 418, currency: 'USD' },
      },
      koAllAbove: true, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 5: 2026-04-15
    cache[`${a.id}__2026-04-15`] = {
      prices: {
        'AAPL': { ok: true, price: 235, currency: 'USD' },
        'MSFT': { ok: true, price: 420, currency: 'USD' },
      },
      koAllAbove: true, hasKI: false, anyError: false, isEnd: false,
    };
  }

  // ── 情境 B：KI 第2月，到期 2026-04-15 接盤 ────────────────────────────────
  const b = contracts.find(c => c.id === 'test-ki-eki-006');
  if (b) {
    // KO 門檻：GOOG=168*105%=176.4, AMD=120*105%=126
    // KI 門檻：GOOG=168*70%=117.6, AMD=120*70%=84
    // Month 1: 2025-11-15 → 正常
    cache[`${b.id}__2025-11-15`] = {
      prices: {
        'GOOG': { ok: true, price: 172, currency: 'USD' },
        'AMD':  { ok: true, price: 118, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 2: 2025-12-15 → GOOG=115 < KI117.6 → KI!
    cache[`${b.id}__2025-12-15`] = {
      prices: {
        'GOOG': { ok: true, price: 115, currency: 'USD' },
        'AMD':  { ok: true, price: 110, currency: 'USD' },
      },
      koAllAbove: false, hasKI: true, anyError: false, isEnd: false,
    };
    // Month 3: 2026-01-15 → 正常（已 KI 但未 KO，繼續持有）
    cache[`${b.id}__2026-01-15`] = {
      prices: {
        'GOOG': { ok: true, price: 125, currency: 'USD' },
        'AMD':  { ok: true, price: 114, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 4: 2026-02-15 → 正常
    cache[`${b.id}__2026-02-15`] = {
      prices: {
        'GOOG': { ok: true, price: 130, currency: 'USD' },
        'AMD':  { ok: true, price: 117, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 5: 2026-03-15 → 正常
    cache[`${b.id}__2026-03-15`] = {
      prices: {
        'GOOG': { ok: true, price: 135, currency: 'USD' },
        'AMD':  { ok: true, price: 119, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 6 / 到期: 2026-04-15
    // GOOG ratio=140/168=0.833, AMD ratio=122/120=1.017 → GOOG 最低
    // Strike = 168*65% = 109.2, shares = 300000/109.2 ≈ 2747
    cache[`${b.id}__2026-04-15`] = {
      prices: {
        'GOOG': { ok: true, price: 140, currency: 'USD' },
        'AMD':  { ok: true, price: 122, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: true,
    };
  }

  // ── 情境 C：進行中，第2月KI ────────────────────────────────────────────────
  const cContract = contracts.find(c => c.id === 'test-active-ki-009');
  if (cContract) {
    // KO: TSLA=350*105%=367.5, NVDA=128*105%=134.4
    // KI: TSLA=350*75%=262.5, NVDA=128*75%=96
    // Month 1: 2026-01-15 → 正常
    cache[`${cContract.id}__2026-01-15`] = {
      prices: {
        'TSLA': { ok: true, price: 340, currency: 'USD' },
        'NVDA': { ok: true, price: 130, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 2: 2026-02-15 → TSLA=250 < KI262.5 → KI!
    cache[`${cContract.id}__2026-02-15`] = {
      prices: {
        'TSLA': { ok: true, price: 250, currency: 'USD' },
        'NVDA': { ok: true, price: 102, currency: 'USD' },
      },
      koAllAbove: false, hasKI: true, anyError: false, isEnd: false,
    };
    // Month 3: 2026-03-15 → 正常（股價回升但未達 KO）
    cache[`${cContract.id}__2026-03-15`] = {
      prices: {
        'TSLA': { ok: true, price: 270, currency: 'USD' },
        'NVDA': { ok: true, price: 115, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
    // Month 4: 2026-04-15 → 正常
    cache[`${cContract.id}__2026-04-15`] = {
      prices: {
        'TSLA': { ok: true, price: 280, currency: 'USD' },
        'NVDA': { ok: true, price: 120, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
  }

  // ── 情境 D：不比價 2 個月 ──────────────────────────────────────────────────
  const d = contracts.find(c => c.id === 'test-noop-002');
  if (d) {
    // 不比價期間：2026-02-15 and 2026-03-15（noopEnd = 2026-03-15）
    // KO: AMZN=198, META=590（100%）
    // KI: AMZN=158.4, META=472（80%）
    // 2026-02-15（在不比價內）：兩股都在 KO 之上，但不觸發
    cache[`${d.id}__2026-02-15`] = {
      prices: {
        'AMZN': { ok: true, price: 200, currency: 'USD' },
        'META': { ok: true, price: 595, currency: 'USD' },
      },
      koAllAbove: true, hasKI: false, anyError: false, isEnd: false,
    };
    // 2026-03-15（在不比價內）：一樣超過 KO 但不觸發
    cache[`${d.id}__2026-03-15`] = {
      prices: {
        'AMZN': { ok: true, price: 202, currency: 'USD' },
        'META': { ok: true, price: 598, currency: 'USD' },
      },
      koAllAbove: true, hasKI: false, anyError: false, isEnd: false,
    };
    // 2026-04-15（不比價結束後第一個正式觀察日）：AMZN=196 < KO198 → 正常未 KO
    cache[`${d.id}__2026-04-15`] = {
      prices: {
        'AMZN': { ok: true, price: 196, currency: 'USD' },
        'META': { ok: true, price: 592, currency: 'USD' },
      },
      koAllAbove: false, hasKI: false, anyError: false, isEnd: false,
    };
  }

  return cache;
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

async function loadTestScenarios() {
  const confirmed = confirm(
    '將用 4 份測試合約取代目前所有資料（不會儲存到磁碟）。\n\n' +
    '情境A：KO 第3月（2026-02-15）→ 自動提前贖回\n' +
    '情境B：KI 第2月（2025-12-15）→ 自動立即接盤（GOOG）\n' +
    '情境C：KI 第2月（2026-02-15）→ 自動立即接盤（TSLA）\n' +
    '情境D：不比價2個月，昨天第一個正式觀察日\n\n' +
    '確定繼續？'
  );
  if (!confirmed) return;

  state.contracts = TEST_CONTRACTS.map(c => ({ ...c }));
  state.histCache = buildMockHistCache(state.contracts);
  state.livePrices = {};
  state.lastRefreshDate = '';
  state.autoProcessedNotices = {};

  renderDashboard();
  await autoProcessContracts();
  console.log('[devTools] 測試資料載入完成，histCache:', state.histCache);
  console.log('[devTools] autoProcessContracts 已執行，contracts:', state.contracts);
}

async function saveTestData() {
  await saveContracts();
  console.log('[devTools] 已儲存到磁碟（userData/fcn_data.json）');
}

window.devTools = { loadTestScenarios, saveTestData };
console.log('[devTools] 測試工具已載入 — 執行 window.devTools.loadTestScenarios() 開始測試');
