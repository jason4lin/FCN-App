import { state } from './state.js';
import { loadContracts, saveContracts, refreshAll } from './api.js';
import { renderDashboard } from './ui/dashboard.js';
import { localDateStr, contractsToCSV, csvToContracts } from './utils.js';
import { initTheme, applyTheme } from './theme.js';

// 主題在 DOM 載入前就要設定，避免閃白
initTheme();
import {
  hideAllModals, showModal,
  openAddModal, openEditModal, openAssignmentModal,
  setSettleMonths, setContractMarket, setUnderlyingCount,
  onContractFormSubmit, onAssignFormSubmit, clearAssignment,
} from './ui/modals.js';

// ── Expose to Window for HTML inline onclick ──────────────────────────────
window.app = {
  openAddModal,
  openEditModal,
  openAssignmentModal,
  confirmDelete,
  dismissNotice,
  setSettleMonths,
  setContractMarket,
  setUnderlyingCount,
  clearAssignment,
  applyTheme,
};

// ── Dismiss auto-process notice ───────────────────────────────────────────
function dismissNotice(id) {
  delete state.autoProcessedNotices[id];
  renderDashboard();
}

// ── Delete ────────────────────────────────────────────────────────────────
async function confirmDelete(id) {
  state.deletingId = id;
  const c = state.contracts.find(x => x.id === id);
  if (!c) return;
  document.getElementById('delete-msg').textContent = `確定要刪除「${c.name || 'FCN 合約'}」嗎？此操作無法復原。`;
  showModal('delete-modal');
}

async function doConfirmDelete() {
  if (!state.deletingId) return;
  state.contracts = state.contracts.filter(x => x.id !== state.deletingId);
  await saveContracts();
  state.deletingId = null;
  hideAllModals();
  renderDashboard();
}

// ── Startup & Event Binding ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {

  // Header buttons
  document.getElementById('add-btn').addEventListener('click', openAddModal);
  document.getElementById('refresh-btn').addEventListener('click', refreshAll);

  // Sidebar navigation
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      state.currentView = el.dataset.view;
      renderDashboard();
    });
  });

  // Sidebar date filters
  document.getElementById('filter-from').addEventListener('change', e => {
    state.filterFrom = e.target.value; renderDashboard();
  });
  document.getElementById('filter-to').addEventListener('change', e => {
    state.filterTo = e.target.value; renderDashboard();
  });

  // Form submissions
  document.getElementById('contract-form').addEventListener('submit', onContractFormSubmit);
  document.getElementById('assign-form').addEventListener('submit', onAssignFormSubmit);

  // Cancel / close buttons
  document.querySelectorAll(
    '#cancel-btn, #assign-cancel-btn, #delete-cancel, #modal-close, #assign-modal-close'
  ).forEach(btn => btn?.addEventListener('click', hideAllModals));

  // Close on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) hideAllModals();
    });
  });

  // ESC key closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideAllModals();
  });

  // Delete confirm
  document.getElementById('assign-clear-btn').addEventListener('click', clearAssignment);
  document.getElementById('delete-confirm').addEventListener('click', doConfirmDelete);
  document.getElementById('delete-cancel').addEventListener('click', hideAllModals);

  // Empty state button
  document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);

  // CSV Export
  document.getElementById('export-btn').addEventListener('click', async () => {
    if (state.contracts.length === 0) { alert('尚無合約可匯出'); return; }
    const result = await window.api.exportCsv(contractsToCSV(state.contracts));
    if (result && !result.ok && result.message) alert('匯出失敗：' + result.message);
  });

  // CSV Import
  document.getElementById('import-btn').addEventListener('click', async () => {
    const file = await window.api.importCsv();
    if (!file?.ok) return;
    const imported = csvToContracts(file.content);
    if (!imported || imported.length === 0) {
      alert('無法解析 CSV 檔案，請確認格式是否正確。'); return;
    }
    if (!confirm(`即將匯入 ${imported.length} 份合約，並取代目前所有 ${state.contracts.length} 份合約。\n\n確定繼續？`)) return;
    state.contracts = imported;
    await saveContracts();
    renderDashboard();
    if (state.contracts.length > 0) await refreshAll();
  });

  // Form dynamic selectors
  document.querySelectorAll('#settle-selector .multi-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.settle === 'custom') {
        document.querySelectorAll('#settle-selector .multi-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('settle-custom-wrap').classList.remove('hidden');
        return;
      }
      setSettleMonths(parseInt(btn.dataset.settle, 10));
      document.getElementById('settle-custom-wrap').classList.add('hidden');
    });
  });
  document.getElementById('f-settle-custom').addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    if (v >= 1) { state.settleMonths = v; document.getElementById('f-settle-months').value = v; }
  });

  document.querySelectorAll('#market-selector .multi-btn').forEach(btn => {
    btn.addEventListener('click', () => setContractMarket(btn.dataset.mkt));
  });

  document.querySelectorAll('#count-selector .multi-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.count === 'custom') {
        document.querySelectorAll('#count-selector .multi-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('count-custom-wrap').classList.remove('hidden');
        return;
      }
      setUnderlyingCount(parseInt(btn.dataset.count, 10), false);
    });
  });
  document.getElementById('f-custom-count').addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    if (v >= 1) setUnderlyingCount(v, false);
  });

  // Settings modal
  document.getElementById('settings-btn').addEventListener('click', () => showModal('settings-modal'));
  document.getElementById('settings-close').addEventListener('click', hideAllModals);
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  // Sort buttons（同一按鈕再按切換升降序，換按鈕則重設方向）
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.sort;
      if (state.sortMode === newMode) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortMode = newMode;
        state.sortDir = newMode === 'next_obs' ? 'asc' : 'desc';
      }
      renderDashboard();
    });
  });

  // Initial Load
  await loadContracts();
  renderDashboard();
  if (state.contracts.length > 0) await refreshAll();
});
