const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getContracts:    ()           => ipcRenderer.invoke('get-contracts'),
  saveContracts:   (contracts)  => ipcRenderer.invoke('save-contracts',    contracts),
  fetchQuote:      (symbol)     => ipcRenderer.invoke('fetch-quote',       symbol),
  fetchPrices:     (symbols)    => ipcRenderer.invoke('fetch-prices',      symbols),
  searchSymbol:    (query)      => ipcRenderer.invoke('search-symbol',     query),
  fetchHistPrices: (payload)    => ipcRenderer.invoke('fetch-hist-prices', payload),
  exportCsv:       (content)    => ipcRenderer.invoke('export-csv',        content),
  importCsv:       ()           => ipcRenderer.invoke('import-csv'),
  getSettings:     ()           => ipcRenderer.invoke('get-settings'),
  saveSettings:    (settings)   => ipcRenderer.invoke('save-settings',     settings),
  fetchPriceRange: (payload)    => ipcRenderer.invoke('fetch-price-range', payload),
  getAppVersion:   ()           => ipcRenderer.invoke('get-app-version'),
  checkForUpdate:     ()       => ipcRenderer.invoke('check-for-update'),
  quitAndInstall:     ()       => ipcRenderer.invoke('quit-and-install'),
  onUpdateDownloaded: (fn)     => ipcRenderer.on('update-downloaded', fn),
  openExternal:    (url)        => ipcRenderer.invoke('open-external',      url),
  exportDiagnostic:(data)       => ipcRenderer.invoke('export-diagnostic',  data),
});
