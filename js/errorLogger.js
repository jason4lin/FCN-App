import { state } from './state.js';

const MAX_ERRORS = 20;

function captureError(message, source, lineno, colno) {
  const entry = {
    time: new Date().toISOString(),
    message: String(message).slice(0, 300),
    source: source ? String(source).replace(/.*[\\/]/, '') : '',
    line: lineno || 0,
    col: colno || 0,
  };
  state.errorLog.unshift(entry);
  if (state.errorLog.length > MAX_ERRORS) state.errorLog.length = MAX_ERRORS;
  showCrashToast(entry.message);
}

function showCrashToast(msg) {
  const toast = document.getElementById('crash-toast');
  if (!toast) return;
  const msgEl = document.getElementById('crash-toast-msg');
  if (msgEl) msgEl.textContent = msg.length > 80 ? msg.slice(0, 77) + '…' : msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.add('hidden'), 10000);
}

export function initErrorLogger() {
  window.onerror = (message, source, lineno, colno) => {
    captureError(message, source, lineno, colno);
    return false;
  };
  window.addEventListener('unhandledrejection', e => {
    const msg = e.reason?.message || String(e.reason) || 'Unhandled Promise Rejection';
    captureError(msg, '', 0, 0);
  });
}
