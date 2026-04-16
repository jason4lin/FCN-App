import { state } from '../state.js';
import { isEnded, contractEndIso, localDateStr, getUncheckedObsDates, getNextObservation, daysUntil } from '../utils.js';
import { buildContractCard } from '../components/cardRenderer.js';

export function updateBadge() {
  const active = state.contracts.filter(c => !isEnded(c)).length;
  const ended  = state.contracts.filter(c => isEnded(c)).length;
  document.getElementById('target-count').textContent = `${state.contracts.length} 份合約`;
  document.getElementById('badge-all').textContent    = state.contracts.length || '';
  document.getElementById('badge-active').textContent = active || '';
  document.getElementById('badge-ended').textContent  = ended  || '';
}

function urgencyScore(c) {
  // 有未讀自動處理通知（即使已結單也浮到上方）
  if (state.autoProcessedNotices[c.id]) return 90;
  if (isEnded(c)) return 5;

  // 有未確認的過去觀察日 → 最高優先（尤其是有 KI 的）
  const unchecked = getUncheckedObsDates(c);
  if (unchecked.length > 0) {
    const hasHistKI = unchecked.some(d => state.histCache[`${c.id}__${d}`]?.hasKI);
    return hasHistKI ? 100 : 80;
  }

  // 即時報價 KI
  for (const u of (c.underlyings || [])) {
    const live = state.livePrices[u.symbol];
    if (!live?.ok || live.price == null) continue;
    const kiPrice = c.kiPercent ? u.basePrice * c.kiPercent / 100 : null;
    if (kiPrice && live.price <= kiPrice) return 95;
  }

  // 下次結算日接近程度（若就是到期日，額外提升優先度）
  const nextObs = getNextObservation(c);
  if (!nextObs) return 30;
  const days = daysUntil(nextObs);
  if (nextObs === contractEndIso(c)) {
    if (days <= 7)  return 72;
    if (days <= 14) return 62;
  }
  if (days <= 3)  return 70;
  if (days <= 7)  return 60;
  if (days <= 30) return 50;
  return 40;
}

export function getFilteredContracts() {
  let list = state.contracts;
  if (state.currentView === 'active') list = list.filter(c => !isEnded(c));
  if (state.currentView === 'ended')  list = list.filter(c => isEnded(c));

  if (state.filterFrom || state.filterTo) {
    list = list.filter(c => {
      const cStart = c.startDate || '0000-00-00';
      const cEnd   = contractEndIso(c) || '9999-12-31';
      const from   = state.filterFrom || '0000-00-00';
      const to     = state.filterTo   || '9999-12-31';
      return (cStart <= to) && (cEnd >= from);
    });
  }

  // 排序
  const mode = state.sortMode || 'urgency';
  const dir  = state.sortDir  === 'asc' ? 1 : -1;
  list = [...list];
  if (mode === 'urgency') {
    list.sort((a, b) => {
      const diff = urgencyScore(b) - urgencyScore(a); // 緊急度固定降冪
      if (diff !== 0) return diff;
      return dir * (a.startDate || '').localeCompare(b.startDate || '');
    });
  } else if (mode === 'next_obs') {
    list.sort((a, b) => {
      const na = getNextObservation(a) || '9999-12-31';
      const nb = getNextObservation(b) || '9999-12-31';
      return dir * na.localeCompare(nb);
    });
  } else if (mode === 'date') {
    list.sort((a, b) => dir * (a.startDate || '').localeCompare(b.startDate || ''));
  }

  return list;
}

export function updatePendingIndicator() {
  const el = document.getElementById('pending-update');
  if (!el) return;
  const today = localDateStr(new Date());
  const activeCount = state.contracts.filter(c => !isEnded(c)).length;
  
  if (activeCount > 0 && state.lastRefreshDate !== today) {
    if (!state.lastRefreshDate) {
      el.textContent = `⚠️ ${activeCount} 個合約尚未取得最新報價`;
    } else {
      el.textContent = `⚠️ 今日尚未更新最新報價`;
    }
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function syncSortButtons() {
  document.querySelectorAll('.sort-btn').forEach(b => {
    const isActive = b.dataset.sort === state.sortMode;
    b.classList.toggle('active', isActive);
    b.classList.remove('sort-asc', 'sort-desc');
    if (isActive) b.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

export function renderDashboard() {
  updateBadge();
  syncSortButtons();
  const list = getFilteredContracts();
  const container = document.getElementById('cards-container');
  const empty = document.getElementById('empty-state');
  
  if (list.length === 0) {
    empty.classList.remove('hidden');
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  
  empty.classList.add('hidden');
  container.classList.remove('hidden');
  container.innerHTML = '';
  list.forEach(c => {
    try {
      container.appendChild(buildContractCard(c));
    } catch (err) {
      console.error('[buildContractCard] 渲染失敗', c.id, err);
    }
  });
  updatePendingIndicator();
}

export function setStatusText(text) { 
  document.getElementById('status-text').textContent = text; 
}
