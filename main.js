const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const { autoUpdater } = require('electron-updater');

// ─── Yahoo Finance 全域實例（懶初始化）────────────────────────────────────────
// v3 必須用 new YahooFinance()，而不是直接用 .default
let _yf;
function getYF() {
  if (!_yf) {
    const YahooFinance = require('yahoo-finance2').default;
    _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }
  return _yf;
}

// ─── 資料路徑（懶初始化，等 app.whenReady 後才可呼叫 getPath）───────────────
let dataFilePath;
function getDataFilePath() {
  if (!dataFilePath) {
    dataFilePath = path.join(app.getPath('userData'), 'fcn_data.json');
    if (!fs.existsSync(dataFilePath)) {
      fs.writeFileSync(dataFilePath, JSON.stringify([], null, 2), 'utf8');
    }
  }
  return dataFilePath;
}

// ─── 視窗建立 ────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'FCN 報價追蹤',
    backgroundColor: '#080e1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    }
  });

  win.loadFile('index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ─── 自動更新 ─────────────────────────────────────────────────────────────────
function initAutoUpdater(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update-available', info.version);
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: '更新就緒',
      message: `新版本已下載完畢，重新啟動後將自動安裝。`,
      buttons: ['立即重啟', '稍後再說'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.checkForUpdatesAndNotify().catch(() => {}); // 離線時靜默失敗
}

// ─── App 生命週期 ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const win = createWindow();
  if (app.isPackaged) initAutoUpdater(win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC：讀取合約清單 ─────────────────────────────────────────────────────────
ipcMain.handle('get-contracts', () => {
  try {
    const raw = fs.readFileSync(getDataFilePath(), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[get-contracts] 讀取失敗:', err.message);
    return [];
  }
});

// ─── IPC：儲存合約清單 ─────────────────────────────────────────────────────────
ipcMain.handle('save-contracts', (_event, contracts) => {
  try {
    fs.writeFileSync(getDataFilePath(), JSON.stringify(contracts, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    console.error('[save-contracts] 寫入失敗:', err.message);
    return { ok: false, message: err.message };
  }
});

// ─── IPC：查詢單一股票報價（輸入時即時搜尋用）───────────────────────────────────
ipcMain.handle('fetch-quote', async (_event, symbol) => {
  const yf = getYF();
  try {
    const q = await yf.quote(symbol);
    return {
      ok:          true,
      price:       q.regularMarketPrice        ?? null,
      prevClose:   q.regularMarketPreviousClose ?? null,
      marketState: q.marketState               || 'CLOSED',
      name:        q.shortName || q.longName   || symbol,
      currency:    q.currency                  || 'USD',
    };
  } catch (err) {
    console.error(`[fetch-quote] ${symbol} 失敗:`, err.message);
    return { ok: false, message: err.message };
  }
});

// ─── IPC：模糊搜尋股票代號（自動建議用）────────────────────────────────────────
ipcMain.handle('search-symbol', async (_event, query) => {
  if (!query || query.trim().length < 1) return [];
  const yf = getYF();
  try {
    const result = await yf.search(query.trim());
    return (result.quotes || [])
      .filter(q => q.quoteType === 'EQUITY' && q.symbol)
      .slice(0, 7)
      .map(q => ({
        symbol: q.symbol,
        name:   q.shortname || q.longname || q.symbol,
      }));
  } catch (err) {
    return [];
  }
});

// ─── IPC：查詢指定日期歷史收盤價 ──────────────────────────────────────────────
ipcMain.handle('fetch-hist-prices', async (_event, { symbols, date }) => {
  const yf  = getYF();
  // 往前查 5 個交易日，確保週末/假日都能找到最近收盤
  const d   = new Date(date);
  const p1  = new Date(d); p1.setDate(p1.getDate() - 5);
  const p2  = new Date(d); p2.setDate(p2.getDate() + 1);
  const p1s = p1.toISOString().slice(0, 10);
  const p2s = p2.toISOString().slice(0, 10);
  const results = {};

  await Promise.allSettled(symbols.map(async sym => {
    try {
      const chart  = await yf.chart(sym, { period1: p1s, period2: p2s, interval: '1d' });
      const quotes = (chart.quotes || [])
        .filter(q => q.close != null)
        .map(q => ({ price: q.close, iso: new Date(q.date).toISOString().slice(0, 10) }))
        .filter(q => q.iso <= date)          // 只取 ≤ 目標日期
        .sort((a, b) => b.iso.localeCompare(a.iso)); // 最近的在前

      results[sym] = quotes.length
        ? { ok: true, price: quotes[0].price, tradingDate: quotes[0].iso }
        : { ok: false };
    } catch (e) {
      results[sym] = { ok: false, message: e.message };
    }
  }));
  return results;
});

// ─── IPC：匯出 CSV ────────────────────────────────────────────────────────────
ipcMain.handle('export-csv', async (_event, csvContent) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '匯出 FCN 合約備份',
    defaultPath: `FCN_backup_${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV 檔案', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.writeFileSync(filePath, '\uFEFF' + csvContent, 'utf8'); // BOM for Excel UTF-8
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// ─── IPC：匯入 CSV ────────────────────────────────────────────────────────────
ipcMain.handle('import-csv', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '匯入 FCN 合約備份',
    filters: [{ name: 'CSV 檔案', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    const content = fs.readFileSync(filePaths[0], 'utf8').replace(/^\uFEFF/, ''); // strip BOM
    return { ok: true, content };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// ─── IPC：批次查詢所有合約標的報價 ──────────────────────────────────────────────
ipcMain.handle('fetch-prices', async (_event, symbols) => {
  const yf = getYF();
  const results = {};

  await Promise.allSettled(
    symbols.map(async (symbol) => {
      try {
        const q = await yf.quote(symbol);
        results[symbol] = {
          ok:            true,
          price:         q.regularMarketPrice           ?? null,
          prevClose:     q.regularMarketPreviousClose   ?? null,
          marketState:   q.marketState                  || 'CLOSED',
          name:          q.shortName || q.longName      || symbol,
          currency:      q.currency                     || '',
          changePercent: q.regularMarketChangePercent   ?? 0,
        };
      } catch (err) {
        console.error(`[fetch-prices] ${symbol} 失敗:`, err.message);
        results[symbol] = { ok: false, message: err.message };
      }
    })
  );

  return results;
});
