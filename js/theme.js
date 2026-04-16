/**
 * 主題管理（亮色 / 暗色 / 跟隨系統）
 */

const STORAGE_KEY = 'fcn-theme-mode';

// 監聽系統 prefers-color-scheme 變更
const _mq = window.matchMedia('(prefers-color-scheme: dark)');

function resolveEffective(mode) {
  if (mode === 'system') return _mq.matches ? 'dark' : 'light';
  return mode; // 'dark' | 'light'
}

export function applyTheme(mode) {
  const effective = resolveEffective(mode);
  document.documentElement.setAttribute('data-theme', effective);
  localStorage.setItem(STORAGE_KEY, mode);

  // 同步 settings panel 的按鈕 active 狀態
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === mode);
  });
}

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY) || 'dark';
  applyTheme(saved);

  // 若使用者選「跟隨系統」，系統切換時即時更新
  _mq.addEventListener('change', () => {
    if ((localStorage.getItem(STORAGE_KEY) || 'dark') === 'system') {
      applyTheme('system');
    }
  });
}

export function getThemeMode() {
  return localStorage.getItem(STORAGE_KEY) || 'dark';
}
