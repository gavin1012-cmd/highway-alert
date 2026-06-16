# 部署指南

## 架構總覽

```
iPhone Safari → GitHub Pages (PWA 前端)
                      ↕
              Cloudflare Worker (免費)
                      ↕
              TISVCLOUD API (高速公路局)
```

---

## Step 1：準備 VAPID 金鑰

VAPID 是 Web Push 的認證機制，需要一對公私鑰。

**安裝 web-push 工具並產生金鑰：**
```bash
npm install -g web-push
web-push generate-vapid-keys
```

輸出範例：
```
Public Key:
BxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxA=

Private Key:
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
```

把這兩個值記下來，後面會用到。

---

## Step 2：部署 Cloudflare Worker

### 2-1. 安裝 Wrangler CLI
```bash
npm install -g wrangler
wrangler login   # 開啟瀏覽器登入 Cloudflare
```

### 2-2. 建立 KV Namespace
```bash
cd cloudflare-worker
wrangler kv:namespace create SESSIONS
```
輸出會給你一個 `id`，填入 `wrangler.toml`：
```toml
[[kv_namespaces]]
binding = "SESSIONS"
id = "貼上這裡"
```

建立 preview namespace（用於本機測試）：
```bash
wrangler kv:namespace create SESSIONS --preview
```
把 preview id 填到 `preview_id`。

### 2-3. 設定 VAPID Secrets
```bash
wrangler secret put VAPID_PRIVATE_KEY
# 貼上 Step 1 的 Private Key，Enter

wrangler secret put VAPID_PUBLIC_KEY
# 貼上 Step 1 的 Public Key，Enter

wrangler secret put VAPID_EMAIL
# 輸入你的 email（例如 ra901012@gmail.com），Enter
```

### 2-4. 部署 Worker
```bash
wrangler deploy
```

部署成功後會顯示：
```
Deployed highway-alert triggers:
  https://highway-alert.YOUR_NAME.workers.dev
  schedule: * * * * *
```

**記下 Worker URL**：`https://highway-alert.YOUR_NAME.workers.dev`

### 2-5. 測試 Worker
```bash
curl https://highway-alert.YOUR_NAME.workers.dev/ping
# 應回傳 {"ok":true,"ts":...}
```

---

## Step 3：部署 PWA 前端（GitHub Pages）

### 3-1. 建立 GitHub Repo
```bash
cd pwa-highway-alert
git init
git add .
git commit -m "Initial PWA"
gh repo create highway-alert --public --push --source=.
```

### 3-2. 開啟 GitHub Pages
在 GitHub repo 設定 → Pages → Source: Deploy from branch → `main` / `(root)`

你的 PWA 網址：`https://YOUR_USERNAME.github.io/highway-alert/`

> ⚠️ **必須是 HTTPS** — Web Push 和 Service Worker 只在 HTTPS 下運作。

### 3-3. 暫時本機測試方式
若沒有 GitHub，可用 [ngrok](https://ngrok.com)：
```bash
ngrok http 3000  # 會給你一個 https://xxxx.ngrok.io 臨時網址
```

---

## Step 4：設定 PWA App

1. 用 iPhone Safari 開啟你的 PWA 網址
2. 點右下角「⚙ 設定」
3. 填入：
   - **Worker URL**：`https://highway-alert.YOUR_NAME.workers.dev`
   - **VAPID 公鑰**：Step 1 的 Public Key
4. 點「儲存設定」→ 確認顯示「✓ Worker 連線正常」

---

## Step 5：安裝到 iPhone 主畫面

1. Safari 點擊底部「分享」按鈕（方框加箭頭）
2. 選「加入主畫面」
3. 名稱填「國道預警」→「新增」

### Step 6：產生 Icon

1. 開啟 `generate-icons.html`（在 Safari 中）
2. 點「產生 Icons」
3. 下載 `icon-192.png` 和 `icon-512.png`
4. 放到 `pwa-highway-alert/icons/` 資料夾
5. 重新 push 到 GitHub

---

## Step 7：首次使用

1. 從主畫面開啟「國道預警」App
2. 允許「位置」權限（選「使用 App 期間」）
3. 允許「通知」權限
4. 點「▶ 開始監控」
5. 即可關閉螢幕 — 背景推播已啟動

---

## 常見問題

### 推播沒有收到？
- 確認 `wrangler.toml` 的 KV id 正確
- 確認三個 secret（VAPID keys + email）都已設定
- 確認 iPhone 的「通知」→「國道預警」已允許
- iOS 16.4+ 才支援 PWA Web Push

### TISVCLOUD 資料取得失敗？
- Worker log: `wrangler tail` 查看即時 log
- 資料只在有車流時才有（深夜可能無資料）

### Cron 沒有執行？
- Cloudflare 免費方案 cron 最低 1 分鐘，但可能有數秒延遲
- 用 `wrangler tail` 觀察 scheduled event log

---

## 費用

全部免費：
- Cloudflare Workers 免費：每天 10 萬次請求、10ms CPU
- Cron Trigger：免費方案包含
- Workers KV：每天 10 萬次讀、1000 次寫
- GitHub Pages：免費

以 10 個 session × 每分鐘 1 次 = 每天 14,400 次，遠低於限額。
