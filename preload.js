const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getContracts:  ()          => ipcRenderer.invoke('get-contracts'),
  saveContracts: (contracts) => ipcRenderer.invoke('save-contracts', contracts),
  fetchQuote:    (symbol)    => ipcRenderer.invoke('fetch-quote',    symbol),
  fetchPrices:   (symbols)   => ipcRenderer.invoke('fetch-prices',   symbols),
  searchSymbol:  (query)     => ipcRenderer.invoke('search-symbol',  query),
  fetchHistPrices: (payload)  => ipcRenderer.invoke('fetch-hist-prices', payload),
  exportCsv:     (content)   => ipcRenderer.invoke('export-csv',     content),
  importCsv:     ()          => ipcRenderer.invoke('import-csv'),
});
