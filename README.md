# FCN Tracker

FCN（Fixed Coupon Note，固定票息商品）桌面追蹤工具，即時監控標的股價與 KO/EKI 觸發條件。

## 功能

- 管理多份 FCN 合約，支援美股、台股（上市/上櫃）
- 即時報價與 KO／EKI 狀態監控
- 歷史觀察日回查，逐日確認 KO 與 EKI 是否觸發
- 記憶式 FCN：各標的獨立記憶，全部達到 KO 門檻後才提前終止
- 到期結算：自動判斷 Situation A／B／C（EKI 旗標 + 到期日收盤價）
- 合約資料 CSV 匯出／匯入備份
- 深色／淺色主題，自動更新

## 下載安裝

前往 [Releases](https://github.com/jason4lin/FCN-App/releases) 下載最新版 `FCN Tracker Setup x.x.x.exe`，執行後依提示安裝即可。

> Windows 可能出現 SmartScreen 警告，點「仍要執行」繼續安裝。此為未購買程式碼簽章的正常現象。

## FCN 規則說明

| 條件 | 說明 |
|------|------|
| **KO（Knock-Out）** | 觀察日當天，**所有**標的收盤價 ≥ KO% × 基準價 → 提前贖回，領回本金 + 當期票息 |
| **EKI（European Knock-In）** | 合約存續期間，**任一**標的曾跌破 EKI% × 基準價 → 到期日以最差標的 Strike 價接盤 |
| **Situation A** | 未曾觸發 EKI → 到期自然還本 + 票息 |
| **Situation B** | 曾觸發 EKI，但到期日收盤已回升 ≥ EKI → 到期自然還本 + 票息 |
| **Situation C** | 曾觸發 EKI，到期日收盤仍 < EKI → 接盤最差標的（以 Strike 價折算股數） |

報價來源為 Yahoo Finance，可能有延遲，僅供參考。

## 資料儲存位置

合約資料與設定存於本機，不上傳任何伺服器：

```
C:\Users\<你的名稱>\AppData\Roaming\FCN Tracker\
  fcn_data.json   — 合約資料
  settings.json   — 應用程式設定
```

解除安裝後資料不會自動刪除，如需清除請手動刪除上述資料夾。

## 問題回報

遇到 bug 或顯示異常，請至 [Issues](https://github.com/jason4lin/FCN-App/issues/new) 建立回報，並附上 App 內「設定 → 問題回報 → 回報問題」匯出的診斷檔案。

## 免責聲明

本工具僅供個人追蹤參考，報價來源為 Yahoo Finance，數據可能有延遲或誤差。本工具不構成任何投資建議，使用者應自行核實數據正確性，並為自身投資決策負責。
