# Hook 推送訊息規格

本工具監控單一 `NAMESPACE`／`DEPLOYMENT`。事件有 `available`（至少一個可用 Pod）、`unavailable`（沒有可用 Pod）及 `logRegex`（符合新日誌完整一行的正則表示式）。首次成功查詢會發送對應的狀態事件；查詢失敗為未知，不發送轉換通知；恢復查詢後依最後已知狀態比較。狀態查詢與網頁狀態顯示各自運作。

## 快速使用

1. 編輯 `config/providers.json` 與 `config/hooks.json`；前者決定發送目的地，後者決定事件、訊息及收件目的地。完整範例見兩個檔案；`config/ntfy-*.json` 是單一目的地的實測範例。
2. 設定 `NAMESPACE`、`DEPLOYMENT` 及 provider 所引用的 webhook 環境變數。若 Pod 的標籤不是 `app=<DEPLOYMENT>`，另設 `POD_LABEL_KEY`。網址可改用 provider 的 `url` 直接指定；設定檔範例皆未包含真實網址。
3. 在專案根目錄執行 `bun run start`；使用 `docker compose up -d` 時，預設掛載 `config/providers.json`、`config/hooks.json` 並要求提供範例中的 `DISCORD_STATUS_WEBHOOK_URL`、`DISCORD_PLAYER_WEBHOOK_URL`。修改 JSON 後需重新啟動。

## 設定檔結構與欄位

機器可讀的結構文件為 [`config/providers.schema.json`](config/providers.schema.json) 與 [`config/hooks.schema.json`](config/hooks.schema.json)；啟動時的實際驗證以 `src/hook-settings.ts` 為準，兩份 JSON Schema 不會自動套用於執行期。JSON Schema 未涵蓋環境變數是否存在、provider 名稱跨檔參照、正則表示式能否編譯、訊息範本的擷取群組，以及 webhook 網址的完整驗證；這些由程式在啟動時驗證。

`providers.json` 頂層是 `{ "providers": [...] }`，`hooks.json` 頂層是 `{ "hooks": [...] }`；兩個陣列可以為空。各項欄位如下，標記「必填」者不可省略且文字不可為空白：

| Provider 欄位 | 值域／預設 | 作用 |
| --- | --- | --- |
| `name` | 必填，至少一個非空白字元的字串，同檔不得重複 | 提供 hook 以名稱引用；沒有指定格式限制 |
| `type` | 必填，只接受 `"discord"` | 選擇發送方式 |
| `url` | 選填，Discord HTTPS webhook 網址，格式 `https://discord.com/api/webhooks/<數字 ID>/<token>`，亦接受 `discordapp.com` | 直接提供目的地；若同時有 `urlEnv`，優先使用 `url`；不接受查詢參數或片段 |
| `urlEnv` | 選填，非空字串 | 存放 webhook 網址的環境變數名稱；未設 `url` 時才讀取，最終無有效網址則啟動失敗 |
| `queueLimit` | 選填，正整數（≥ 1），預設 `20` | 該 provider 最多暫存的訊息筆數；超出者計入丟棄數，不提前發送 |
| `intervalSeconds` | 選填，正整數（≥ 1），預設 `1` | 該 provider 嘗試合併發送佇列的秒數 |

| Hook 欄位 | 值域／預設 | 作用 |
| --- | --- | --- |
| `name` | 必填，至少一個非空白字元的字串，同檔不得重複 | 辨識 hook；同一事件可以設定多筆不同名稱的 hook |
| `type` | 必填，`"available"`、`"unavailable"`、`"logRegex"` 之一 | 選擇觸發事件 |
| `message` | 必填，非空字串 | 發送內容；`logRegex` 可用 `{{群組名}}` 代入 regex 命名擷取群組；其他類型不可使用擷取語法 |
| `providers` | 必填，至少一個不重複且已定義的 provider 名稱 | 一筆 hook 可發往多個目的地；每個目的地各自計算佇列與丟棄數 |
| `regex` | `logRegex` 必填，非空且可編譯的 JavaScript 正則表示式來源字串 | 對每行新 Pod 日誌進行比對；在 JSON 中反斜線須寫成 `\\`，如 `\\d+`；不支援另外指定旗標 |
| `bufferLimit` | 選填，正整數（≥ 1），預設 `20` | 該 hook 在分發週期內最多暫存的命中訊息筆數；超出者計入丟棄數；狀態事件無暫存階段 |

例如 `"regex": "messages_published=(?<count>\\d+)"` 搭配 `"message": "發布數：{{count}}"`，日誌包含 `messages_published=3085` 時會產生「發布數：3085」。若文字只有固定內容，`logRegex` 的 `message` 不需要擷取變數。各 hook 產生的文字會先按 provider 合併；Discord 接收一則換行分隔的內容，而非每個 hook 各發一則。

未知欄位目前不影響執行、也不會生效；設定錯誤會使服務在啟動階段失敗並顯示原因。若兩個預設設定檔都不存在且未覆寫路徑，通知功能不啟用；只要其中一個檔案存在或設定了覆寫路徑，兩份檔案都必須存在且有效。相對路徑以啟動時的工作目錄為基準。

## 環境變數

| 變數 | 值域／預設 | 作用 |
| --- | --- | --- |
| `NAMESPACE` | 必填，非空 | 目標 Kubernetes 命名空間 |
| `DEPLOYMENT` | 必填，非空 | 目標 Deployment 名稱；也作為 Pod 標籤的值 |
| `POD_LABEL_KEY` | 選填，合法 Kubernetes 標籤鍵，預設 `app` | 選取 Pod 的標籤鍵；如 `app.kubernetes.io/name`。監控與網頁日誌查詢都使用 `<POD_LABEL_KEY>=<DEPLOYMENT>` |
| `PROVIDERS_CONFIG_PATH` | 選填，預設 `config/providers.json` | provider JSON 路徑；容器中預設使用 `/app/config/providers.json` |
| `HOOKS_CONFIG_PATH` | 選填，預設 `config/hooks.json` | hook JSON 路徑；容器中預設使用 `/app/config/hooks.json` |
| `AVAILABLE_INTERVAL_SECONDS` | 選填，正整數（≥ 1），預設 `10` | 已知不可用時，查詢何時恢復可用 |
| `UNAVAILABLE_INTERVAL_SECONDS` | 選填，正整數（≥ 1），預設 `10` | 已知可用時，查詢何時不可用；首次尚未知曉時採兩者較短者 |
| `LOG_REGEX_INTERVAL_SECONDS` | 選填，正整數（≥ 1），預設 `10` | 將即時 regex 比對結果從 hook 暫存分發給 provider 的週期；**不是**日誌串流的輪詢週期 |
| `PORT` | 選填，預設 `3000` | 本機網頁服務監聽埠 |
| `KUBECONFIG` | 視 kubectl 環境而定 | 叢集認證設定；Compose 預設唯讀掛載本機 kubeconfig |

`urlEnv` 可引用任意已注入的環境變數，例如 `DEV_DISCORD_URL`。Compose 範例直接要求兩個 `DISCORD_*_WEBHOOK_URL` 變數；若改用其他 provider 檔，需同步調整 Compose 的變數與檔案掛載，或使用上方本機指令執行。

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
