/**
 * 開發測試工具
 * DevTools Console 執行：
 *   window.devTools.runTests()          → 跑完整自動化測試
 *   window.devTools.loadScenario(name)  → 載入單一情境供視覺確認
 *   window.devTools.scenarios           → 列出所有情境名稱
 */

import { state } from './state.js';
import { renderDashboard } from './ui/dashboard.js';
import { saveContracts, autoProcessContracts, runKOMemoryCheck } from './api.js';

// ─── 共用工具 ─────────────────────────────────────────────────────────────────

/** 製作 histCache 項目（自動算 koAllAbove / hasKI） */
function hist(contractId, date, endIso, pricesMap, underlyings, koPercent, kiPercent) {
  let koAllAbove = !!underlyings.length, hasKI = false;
  const prices = {};
  for (const [sym, price] of Object.entries(pricesMap)) {
    prices[sym] = { ok: true, price, currency: 'USD', prevClose: price, marketState: 'CLOSED', changePercent: 0 };
    const u = underlyings.find(x => x.symbol === sym);
    if (!u) continue;
    if (koPercent && price < u.basePrice * koPercent / 100) koAllAbove = false;
    if (kiPercent && price <= u.basePrice * kiPercent / 100) hasKI = true;
  }
  return { key: `${contractId}__${date}`, val: { prices, koAllAbove, hasKI, anyError: false, isEnd: date === endIso } };
}

function addHist(cache, ...args) {
  const { key, val } = hist(...args);
  cache[key] = val;
}

// ─── 測試情境定義 ─────────────────────────────────────────────────────────────
// 今天 = 2026-04-16

const SCENARIOS = {

  // ── T1：KO 普通模式 — 第3月同日全部達標，提前贖回 ──────────────────────────
  'T1-ko-normal': {
    desc: 'T1 KO 普通模式（第3月全達標）',
    settings: { memoryKO: false },
    contracts: [{
      id: 'T1', name: 'T1 KO 第3月', market: 'US',
      startDate: '2025-11-15', durationMonths: 12, noopMonths: 0, settlementMonths: 1,
      koPercent: 100, strikePercent: 75, kiPercent: 75,
      principal: 500000, couponPercent: 18,
      underlyings: [
        { symbol: 'AAPL', name: 'Apple',     basePrice: 226, currency: 'USD' },
        { symbol: 'MSFT', name: 'Microsoft', basePrice: 408, currency: 'USD' },
      ],
      redeemedDate: null, assignment: null, frozenPrices: null, createdAt: Date.now(),
    }],
    buildCache(contracts) {
      const c = contracts[0], u = c.underlyings, end = '2026-11-15';
      const cache = {};
      // 月1 正常
      addHist(cache, c.id, '2025-12-15', end, { AAPL: 220, MSFT: 405 }, u, c.koPercent, c.kiPercent);
      // 月2 正常
      addHist(cache, c.id, '2026-01-15', end, { AAPL: 218, MSFT: 412 }, u, c.koPercent, c.kiPercent);
      // 月3 KO！AAPL=230>226, MSFT=415>408
      addHist(cache, c.id, '2026-02-15', end, { AAPL: 230, MSFT: 415 }, u, c.koPercent, c.kiPercent);
      // 月4、5 存著讓 allReady 通過（不會被使用）
      addHist(cache, c.id, '2026-03-15', end, { AAPL: 232, MSFT: 418 }, u, c.koPercent, c.kiPercent);
      addHist(cache, c.id, '2026-04-15', end, { AAPL: 235, MSFT: 420 }, u, c.koPercent, c.kiPercent);
      return cache;
    },
    expect: { redeemedDate: '2026-02-15', assignment: null, noticeType: 'ko' },
  },

  // ── T2：情境 A — 從未觸及 EKI，自然到期 ────────────────────────────────────
  'T2-eki-situation-a': {
    desc: 'T2 情境A — 從未 EKI → 自然到期',
    settings: { memoryKO: false },
    contracts: [{
      id: 'T2', name: 'T2 情境A', market: 'US',
      startDate: '2026-01-14', durationMonths: 3, noopMonths: 0, settlementMonths: 1,
      koPercent: 105, strikePercent: 65, kiPercent: 70,
      principal: 300000, couponPercent: 15,
      underlyings: [
        { symbol: 'GOOG', name: 'Alphabet', basePrice: 168, currency: 'USD' }, // EKI=117.6
        { symbol: 'AMD',  name: 'AMD',      basePrice: 120, currency: 'USD' }, // EKI=84
      ],
      redeemedDate: null, assignment: null, frozenPrices: null, createdAt: Date.now(),
    }],
    buildCache(contracts) {
      const c = contracts[0], u = c.underlyings, end = '2026-04-14';
      const cache = {};
      addHist(cache, c.id, '2026-02-14', end, { GOOG: 160, AMD: 115 }, u, c.koPercent, c.kiPercent); // 正常
      addHist(cache, c.id, '2026-03-14', end, { GOOG: 155, AMD: 110 }, u, c.koPercent, c.kiPercent); // 正常，高於 EKI
      addHist(cache, c.id, '2026-04-14', end, { GOOG: 150, AMD: 105 }, u, c.koPercent, c.kiPercent); // 到期，從未 EKI
      return cache;
    },
    expect: { redeemedDate: '2026-04-14', assignment: null, noticeType: 'natural' },
  },

  // ── T3：情境 B — EKI 觸及後到期漲回，仍自然到期 ────────────────────────────
  'T3-eki-situation-b': {
    desc: 'T3 情境B — EKI 觸及但到期漲回 → 自然到期（不接盤）',
    settings: { memoryKO: false },
    contracts: [{
      id: 'T3', name: 'T3 情境B', market: 'US',
      startDate: '2026-01-14', durationMonths: 3, noopMonths: 0, settlementMonths: 1,
      koPercent: 105, strikePercent: 65, kiPercent: 70,
      principal: 300000, couponPercent: 15,
      underlyings: [
        { symbol: 'GOOG', name: 'Alphabet', basePrice: 168, currency: 'USD' }, // EKI=117.6
        { symbol: 'AMD',  name: 'AMD',      basePrice: 120, currency: 'USD' }, // EKI=84
      ],
      redeemedDate: null, assignment: null, frozenPrices: null, createdAt: Date.now(),
    }],
    buildCache(contracts) {
      const c = contracts[0], u = c.underlyings, end = '2026-04-14';
      const cache = {};
      addHist(cache, c.id, '2026-02-14', end, { GOOG: 160, AMD: 115 }, u, c.koPercent, c.kiPercent); // 正常
      // 月2 GOOG=110 < EKI 117.6 → hasKI=true → everKI=true
      addHist(cache, c.id, '2026-03-14', end, { GOOG: 110, AMD:  80 }, u, c.koPercent, c.kiPercent);
      // 到期日：GOOG=130 > EKI 117.6, AMD=100 > EKI 84 → 情境 B → 自然到期
      addHist(cache, c.id, '2026-04-14', end, { GOOG: 130, AMD: 100 }, u, c.koPercent, c.kiPercent);
      return cache;
    },
    expect: { redeemedDate: '2026-04-14', assignment: null, noticeType: 'natural' },
  },

  // ── T4：情境 C — EKI 觸及且到期未漲回，接盤 ────────────────────────────────
  'T4-eki-situation-c': {
    desc: 'T4 情境C — EKI 觸及且到期未漲回 → 接盤（AMD）',
    settings: { memoryKO: false },
    contracts: [{
      id: 'T4', name: 'T4 情境C', market: 'US',
      startDate: '2026-01-14', durationMonths: 3, noopMonths: 0, settlementMonths: 1,
      koPercent: 105, strikePercent: 65, kiPercent: 70,
      principal: 300000, couponPercent: 15,
      underlyings: [
        { symbol: 'GOOG', name: 'Alphabet', basePrice: 168, currency: 'USD' }, // EKI=117.6, Strike=109.2
        { symbol: 'AMD',  name: 'AMD',      basePrice: 120, currency: 'USD' }, // EKI=84, Strike=78
      ],
      redeemedDate: null, assignment: null, frozenPrices: null, createdAt: Date.now(),
    }],
    buildCache(contracts) {
      const c = contracts[0], u = c.underlyings, end = '2026-04-14';
      const cache = {};
      addHist(cache, c.id, '2026-02-14', end, { GOOG: 160, AMD: 115 }, u, c.koPercent, c.kiPercent); // 正常
      // 月2 兩股都跌破 EKI
      addHist(cache, c.id, '2026-03-14', end, { GOOG: 110, AMD:  70 }, u, c.koPercent, c.kiPercent);
      // 到期日：GOOG=100 (ratio=0.595), AMD=70 (ratio=0.583) → AMD 比例最低（最差）
      // AMD < EKI(84) → 情境 C → 接盤 AMD，Strike=78
      addHist(cache, c.id, '2026-04-14', end, { GOOG: 100, AMD:  70 }, u, c.koPercent, c.kiPercent);
      return cache;
    },
    // AMD ratio=70/120=0.583 < GOOG ratio=100/168=0.595 → AMD is worst
    // AMD endPrice=70 < AMD kiPrice=84 → assign AMD at Strike=78
    expect: { redeemedDate: null, assignment: { date: '2026-04-14', symbol: 'AMD' }, noticeType: 'ki_assigned' },
  },

  // ── T5：NOOP 保護 — 不比價期間 KO 不觸發 ────────────────────────────────────
  'T5-noop-protection': {
    desc: 'T5 NOOP 保護（2個月）— KO 在保護期內不觸發',
    settings: { memoryKO: false },
    contracts: [{
      id: 'T5', name: 'T5 NOOP', market: 'US',
      startDate: '2026-01-15', durationMonths: 12, noopMonths: 2, settlementMonths: 1,
      koPercent: 100, strikePercent: 80, kiPercent: 80,
      principal: 200000, couponPercent: 12,
      underlyings: [
        { symbol: 'AMZN', name: 'Amazon', basePrice: 198, currency: 'USD' }, // KO=198
        { symbol: 'META', name: 'Meta',   basePrice: 590, currency: 'USD' }, // KO=590
      ],
      redeemedDate: null, assignment: null, frozenPrices: null, createdAt: Date.now(),
    }],
    buildCache(contracts) {
      const c = contracts[0], u = c.underlyings, end = '2027-01-15';
      const cache = {};
      // noopEnd = 2026-03-15；兩個月內即使 koAllAbove 也不觸發
      addHist(cache, c.id, '2026-02-15', end, { AMZN: 202, META: 600 }, u, c.koPercent, c.kiPercent); // noop，above KO
      addHist(cache, c.id, '2026-03-15', end, { AMZN: 205, META: 605 }, u, c.koPercent, c.kiPercent); // noop，above KO
      // 2026-04-15：出了 noop 但 AMZN=195 < KO 198 → 未 KO
      addHist(cache, c.id, '2026-04-15', end, { AMZN: 195, META: 600 }, u, c.koPercent, c.kiPercent);
      return cache;
    },
    expect: { redeemedDate: null, assignment: null, noticeType: null },
  },

  // ── T6：記憶式 FCN — 各標的不同日達標，全部記憶後終止 ───────────────────────
  'T6-memory-fcn': {
    desc: 'T6 記憶式 FCN — AAPL 2026-02-20、MSFT 2026-03-10，終止於 2026-03-10',
    settings: { memoryKO: true },
    contracts: [{
      id: 'T6', name: 'T6 記憶式 FCN', market: 'US',
      startDate: '2025-11-15', durationMonths: 6, noopMonths: 0, settlementMonths: 1,
      koPercent: 100, strikePercent: 75, kiPercent: 75,
      principal: 500000, couponPercent: 18,
      underlyings: [
        { symbol: 'AAPL', name: 'Apple',     basePrice: 226, currency: 'USD' },
        { symbol: 'MSFT', name: 'Microsoft', basePrice: 408, currency: 'USD' },
      ],
      redeemedDate: null, assignment: null, frozenPrices: null, createdAt: Date.now(),
    }],
    buildCache() { return {}; },
    // 預先填入 koMemory（模擬每日抓價結果）
    koMemory: {
      'T6': { 'AAPL': '2026-02-20', 'MSFT': '2026-03-10' },
    },
    expect: { redeemedDate: '2026-03-10', assignment: null, noticeType: 'ko' },
  },
};

// ─── 測試執行器 ───────────────────────────────────────────────────────────────

function assert(label, actual, expected) {
  if (actual === expected) return null;
  return `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

async function runOneTest(key, scenario) {
  // 備份
  const origContracts = state.contracts;
  const origCache     = state.histCache;
  const origMemory    = state.koMemory;
  const origNotices   = state.autoProcessedNotices;
  const origSettings  = state.settings;

  try {
    state.contracts            = scenario.contracts.map(c => ({ ...c }));
    state.histCache            = scenario.buildCache(state.contracts);
    state.koMemory             = JSON.parse(JSON.stringify(scenario.koMemory || {}));
    state.autoProcessedNotices = {};
    state.settings             = { ...state.settings, ...scenario.settings };

    if (state.settings.memoryKO) await runKOMemoryCheck();
    await autoProcessContracts();

    const c    = state.contracts[0];
    const note = state.autoProcessedNotices[c.id] || null;
    const exp  = scenario.expect;
    const failures = [
      exp.redeemedDate !== undefined ? assert('redeemedDate', c.redeemedDate, exp.redeemedDate) : null,
      'assignment' in exp ? (
        exp.assignment === null
          ? assert('assignment', c.assignment, null)
          : c.assignment == null
            ? `assignment: expected object, got null`
            : (assert('assignment.date',   c.assignment.date,   exp.assignment.date)
            || assert('assignment.symbol', c.assignment.symbol, exp.assignment.symbol))
      ) : null,
      exp.noticeType !== undefined
        ? assert('noticeType', note?.type ?? null, exp.noticeType)
        : null,
    ].filter(Boolean);

    return { key, desc: scenario.desc, pass: failures.length === 0, failures };
  } finally {
    state.contracts            = origContracts;
    state.histCache            = origCache;
    state.koMemory             = origMemory;
    state.autoProcessedNotices = origNotices;
    state.settings             = origSettings;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════');
  console.log('  FCN Tracker 自動化測試');
  console.log('═══════════════════════════════════════');

  const results = [];
  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    const result = await runOneTest(key, scenario);
    results.push(result);
    if (result.pass) {
      console.log(`✅ ${result.desc}`);
    } else {
      console.error(`❌ ${result.desc}`);
      result.failures.forEach(f => console.error(`   ↳ ${f}`));
    }
  }

  const passed = results.filter(r => r.pass).length;
  const total  = results.length;
  console.log('───────────────────────────────────────');
  console.log(`結果：${passed} / ${total} 通過`);
  console.log('═══════════════════════════════════════');

  showResultPanel(results);
  return results;
}

// ─── 測試結果浮動面板 ─────────────────────────────────────────────────────────

function showResultPanel(results) {
  document.getElementById('dev-test-panel')?.remove();
  const passed = results.filter(r => r.pass).length;
  const total  = results.length;
  const allPass = passed === total;

  const panel = document.createElement('div');
  panel.id = 'dev-test-panel';
  panel.style.cssText = `
    position: fixed; bottom: 16px; right: 16px; z-index: 9999;
    background: #1e293b; border: 1.5px solid ${allPass ? '#22c55e' : '#ef4444'};
    border-radius: 10px; padding: 14px 16px; min-width: 320px;
    font-family: 'Inter', monospace; font-size: 12px; color: #e2e8f0;
    box-shadow: 0 8px 24px rgba(0,0,0,.5);
  `;

  const rows = results.map(r => `
    <div style="display:flex;gap:8px;align-items:baseline;padding:3px 0;
                border-bottom:1px solid #334155;">
      <span style="color:${r.pass ? '#22c55e' : '#ef4444'};font-size:13px;">
        ${r.pass ? '✅' : '❌'}
      </span>
      <div>
        <span style="color:${r.pass ? '#cbd5e1' : '#fca5a5'}">${r.desc}</span>
        ${r.failures.map(f => `<div style="color:#f87171;font-size:11px;margin-top:2px">↳ ${f}</div>`).join('')}
      </div>
    </div>
  `).join('');

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <strong style="color:${allPass ? '#4ade80' : '#f87171'}">
        測試 ${passed}/${total} 通過
      </strong>
      <button onclick="this.closest('#dev-test-panel').remove()"
        style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">✕</button>
    </div>
    ${rows}
  `;
  document.body.appendChild(panel);
}

// ─── 互動式情境載入（視覺確認用）────────────────────────────────────────────

async function loadScenario(key) {
  const scenario = SCENARIOS[key];
  if (!scenario) {
    console.warn(`找不到情境 "${key}"，可用情境：`, Object.keys(SCENARIOS));
    return;
  }
  const ok = confirm(
    `將用「${scenario.desc}」測試資料取代目前所有合約（不儲存至磁碟）。\n確定繼續？`
  );
  if (!ok) return;

  state.contracts            = scenario.contracts.map(c => ({ ...c }));
  state.histCache            = scenario.buildCache(state.contracts);
  state.koMemory             = JSON.parse(JSON.stringify(scenario.koMemory || {}));
  state.autoProcessedNotices = {};
  state.settings             = { ...state.settings, ...scenario.settings };
  state.livePrices           = {};

  renderDashboard();
  if (state.settings.memoryKO) await runKOMemoryCheck();
  await autoProcessContracts();
  console.log(`[devTools] 情境 "${key}" 載入完成`);
  console.log('contracts:', state.contracts);
  console.log('notices:', state.autoProcessedNotices);
}

async function saveCurrentTestData() {
  await saveContracts();
  console.log('[devTools] 已儲存到磁碟（userData/fcn_data.json）');
}

window.devTools = {
  runTests,
  loadScenario,
  saveCurrentTestData,
  scenarios: Object.keys(SCENARIOS),
};

console.log(
  '[devTools] 測試工具已載入\n' +
  '  window.devTools.runTests()           → 跑完整自動化測試（6個情境）\n' +
  '  window.devTools.loadScenario("T1-ko-normal") → 互動式載入單一情境\n' +
  '  window.devTools.scenarios            → 列出所有情境名稱'
);
