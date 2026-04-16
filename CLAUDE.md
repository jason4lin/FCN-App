# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案簡介

**FCN Tracker** 是一個桌面應用程式，用於追蹤固定票息商品（Fixed Coupon Note, FCN）的報價與敲出條件。使用 Electron 建構，資料來源為 Yahoo Finance API。

## 常用指令

```bash
# 開發模式啟動
npm start

# 打包成 Windows x64 執行檔（輸出至 dist/FCN_Tracker-win32-x64/）
npm run pack
```

## 架構概覽

這是一個**純 Electron 桌面應用**，無前端框架，分為三層：

### 主進程 (`main.js`)
- 管理視窗生命週期與 IPC 處理
- 所有 Yahoo Finance API 呼叫都在此執行（lazy-initialized）
- 資料持久化至 `userData/fcn_data.json`（Electron 管理的用戶目錄）
- IPC Handlers：`get-contracts`、`save-contracts`、`fetch-quote`、`search-symbol`、`fetch-prices`

### 橋接層 (`preload.js`)
- 以 `contextBridge` 將 IPC 安全暴露給渲染進程
- 對應方法：`window.electronAPI.getContracts/saveContracts/fetchQuote/fetchPrices/searchSymbol`

### 渲染進程 (`renderer.js`)
- 使用原生 DOM 操作，無框架
- 全域狀態變數：`contracts[]`、`livePrices{}`、`editingId`、`deletingId`
- `migrateContracts()` 負責舊資料的向前相容遷移
- FCN 核心邏輯：計算觀察日期、KO/KI/Strike 門檻比較

## FCN 金融邏輯

合約結構與判斷邏輯在 `renderer.js` 中：

- **KO（Knock-Out）**：所有標的股價 ≥ KO% × 基準價 → 提前贖回
- **KI（Knock-In）**：任一標的股價 ≤ KI% × 基準價 → 歐式敲入條件觸發
- **Strike**：敲入後結算用的參考比例
- **NOOP 期間**：合約起始的免觀察月數
- **觀察頻率**：`settlementMonths` 決定（每月/每季/每年）

## 資料格式

合約儲存於 `userData/fcn_data.json`，每筆合約的關鍵欄位：

```javascript
{
  id, name, startDate, durationMonths, noopMonths, settlementMonths,
  market: 'US' | 'TW' | 'TWO',
  koPercent, strikePercent, kiPercent,
  underlyings: [{ symbol, name, basePrice, currency }]
}
```

## 主要注意事項

- **IPC 安全**：所有 Yahoo Finance 呼叫必須走主進程，禁止在渲染進程直接呼叫外部 API
- **XSS 防護**：動態插入 HTML 時必須使用 `escHtml()` 工具函數
- **資料遷移**：新增合約欄位時需同步更新 `migrateContracts()`，確保舊資料相容
- **批次請求**：多標的報價使用 `Promise.allSettled()`，單一失敗不影響整體
- **UI 語言**：介面字串全為繁體中文
