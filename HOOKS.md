# Hook 推送訊息規格

本工具監控單一 `NAMESPACE`／`DEPLOYMENT`。事件有 `available`（至少一個可用 Pod）、`unavailable`（沒有可用 Pod）及 `logRegex`（符合新日誌完整一行的正則表示式）。首次成功查詢會發送對應的狀態事件；查詢失敗為未知，不發送轉換通知；恢復查詢後依最後已知狀態比較。狀態查詢與網頁狀態顯示各自運作。

## 設定與啟動

- `config/providers.json`、`config/hooks.json` 分別定義 `providers`、`hooks` 陣列。用 `PROVIDERS_CONFIG_PATH`、`HOOKS_CONFIG_PATH` 覆寫各自路徑。兩個預設檔案均不存在且未覆寫路徑時不啟用通知；其餘情況缺檔或設定有誤均啟動失敗。修改檔案後須重新啟動。
- `AVAILABLE_INTERVAL_SECONDS`：已知不可用時，檢查是否恢復的間隔；`UNAVAILABLE_INTERVAL_SECONDS`：已知可用時，檢查是否失去可用性的間隔；首次未知時使用兩者較短者。`LOG_REGEX_INTERVAL_SECONDS`：將已比對的日誌訊息分發到 provider 佇列的間隔。三者預設均為 10 秒，須為正整數。
- 第一階段 provider 類型只有 `discord`。每個 provider 的 `name` 唯一；`url` 可直接指定 Discord webhook 網址，`urlEnv` 可指定存放網址的環境變數名稱；同時指定時以 `url` 優先。沒有有效網址即啟動失敗。`queueLimit` 預設 20 筆，`intervalSeconds` 預設 1 秒，皆可按 provider 設定。
- 每個 hook 的 `name` 唯一，`type` 為 `available`、`unavailable` 或 `logRegex`，`providers` 是非空且不重複的 provider 名稱陣列，`message` 為非空文字。`logRegex` 另需 `regex`，可以命名擷取 `(?<id>...)` 並於訊息內使用 `{{id}}`；`bufferLimit` 預設 20 筆。範例見 `config/`。兩份範例以環境變數提供網址，不包含有效 webhook 金鑰；啟用範例前必須自行設定兩個環境變數。

## 監控與發送

- 狀態以 Deployment 的 `status.availableReplicas` 判定。`POD_LABEL_KEY` 控制 Pod 查詢使用的標籤鍵，預設 `app`；日誌監控與網頁日誌查詢皆使用 `${POD_LABEL_KEY}=${DEPLOYMENT}`，追蹤所有符合條件的 Pod／容器。日誌串流持續接收，只有讀到換行的完整行才比對；未完成行不比對。單行超過 65536 字時捨棄並記錄原因；每 10 秒偵測新 Pod 及重連中斷的串流。
- `logRegex` 每個 hook 立即比對完整日誌行，最多暫存 `bufferLimit` 筆符合結果；超出計數為丟棄。每隔 `LOG_REGEX_INTERVAL_SECONDS` 將結果與丟棄數分別送給對應的 provider。provider 佇列滿時繼續累計丟棄數，不提前發送。相同 provider 收到多個 hook 的訊息時合併為一則，以換行分隔。
- 每個 provider 每隔 `intervalSeconds` 嘗試發送一次；空佇列且無丟棄數不發送。Discord 只呈現合併原文的前 1800 字；超出時附上字數過長提示，並優先保留佇列滿造成的丟棄數與調整發送秒數／佇列上限的建議。Discord `content` 不超過 2000 字；省略的原文不會於下一次補送。只有 Discord 確認送達才清除佇列；失敗時保留並於下個可發送時刻重試，速率限制遵守 `Retry-After`。
- 日誌串流失敗時，依每個 Pod／容器最後讀取的時間盡力重連補讀；可能重複，日誌輪替或高流量下可能遺漏。程序重啟後不追溯舊日誌，也不還原記憶體佇列。串流失敗、送訊失敗與丟棄會在服務日誌記錄來源及原因。日誌 hook 的多筆命中不防重；每次命中都會嘗試分發。

## ntfy 單一 provider 實測設定

`config/ntfy-providers.json` 與 `config/ntfy-hooks.json` 共用一個 `DEV_DISCORD_URL`，示範首次可用、不可用與每分鐘 `INFO Server stats` 中的 `messages_published` 命名擷取。本機測試指令：

```sh
fnox exec -- env NAMESPACE=ntfy DEPLOYMENT=ntfy POD_LABEL_KEY=app.kubernetes.io/name \
  PROVIDERS_CONFIG_PATH=config/ntfy-providers.json HOOKS_CONFIG_PATH=config/ntfy-hooks.json \
  bun run src/index.ts
```

若環境已直接提供 `DEV_DISCORD_URL`，可移除 `fnox exec --`。測試縮放之前請確認目前 Deployment 副本數，結束後恢復原值；此範例不含真實 Discord 網址。
