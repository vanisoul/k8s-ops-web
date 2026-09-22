import { Hono } from "hono";
import { restartDeployment, getPodLogs, getPodResources, getStatus } from "./kubectl";

const app = new Hono();

// Serve UI
app.get("/", (c) => {
  return c.html(indexHtml);
});

// API: Restart deployment (scale 0 -> 1)
app.post("/api/restart", async (c) => {
  const result = await restartDeployment();
  const status = result.success ? 200 : 500;
  return c.json({ ...result, timestamp: new Date().toISOString() }, status);
});

// API: Get pod logs
app.get("/api/logs", async (c) => {
  const tail = Number(c.req.query("tail") || "200");
  const result = await getPodLogs(tail);
  const status = result.success ? 200 : 500;
  return c.json({ ...result, timestamp: new Date().toISOString() }, status);
});

// API: Get pod resource usage
app.get("/api/resources", async (c) => {
  const result = await getPodResources();
  const status = result.success ? 200 : 500;
  return c.json({ ...result, timestamp: new Date().toISOString() }, status);
});

// API: Get deployment & pod status
app.get("/api/status", async (c) => {
  const result = await getStatus();
  const status = result.success ? 200 : 500;
  return c.json({ ...result, timestamp: new Date().toISOString() }, status);
});

const port = Number(process.env.PORT || "3000");
console.log(`Kubernetes Ops Web listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};

const indexHtml = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kubernetes Ops</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 20px; }
  .container { max-width: 1000px; margin: 0 auto; }
  h1 { text-align: center; margin-bottom: 24px; color: #38bdf8; font-size: 1.8rem; }
  .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #334155; }
  .card h2 { color: #94a3b8; font-size: 1rem; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .btn { padding: 10px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 0.95rem; font-weight: 600; transition: all 0.2s; }
  .btn-danger { background: #dc2626; color: white; }
  .btn-danger:hover { background: #ef4444; }
  .btn-danger:disabled { background: #991b1b; cursor: not-allowed; opacity: 0.7; }
  .btn-primary { background: #2563eb; color: white; }
  .btn-primary:hover { background: #3b82f6; }
  .btn-sm { padding: 6px 14px; font-size: 0.85rem; }
  .log-box { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px; font-family: 'Menlo', 'Courier New', monospace; font-size: 0.8rem; line-height: 1.5; max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
  .status-box { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 0.85rem; white-space: pre-wrap; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
  .toolbar .spacer { flex: 1; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
  .badge-green { background: #166534; color: #4ade80; }
  .badge-red { background: #991b1b; color: #fca5a5; }
  .badge-yellow { background: #854d0e; color: #fde047; }
  .msg { margin-top: 8px; padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; }
  .msg-ok { background: #166534; color: #bbf7d0; }
  .msg-err { background: #991b1b; color: #fecaca; }
  .loading { color: #94a3b8; font-style: italic; }
</style>
</head>
<body>
<div class="container">
  <h1>Kubernetes Ops Controller</h1>

  <!-- Status Card -->
  <div class="card">
    <div class="toolbar">
      <h2>Deployment 狀態</h2>
      <div class="spacer"></div>
      <span id="statusBadge" class="badge badge-yellow">載入中</span>
      <button class="btn btn-primary btn-sm" onclick="loadStatus()">重新整理</button>
    </div>
    <div id="statusContent" class="status-box loading">載入中...</div>
  </div>

  <!-- Restart Card -->
  <div class="card">
    <h2>滾動重啟</h2>
    <p style="color:#94a3b8;margin-bottom:12px;font-size:0.85rem;">將 Deployment 縮放至 0 再恢復至 1，強制拉取最新映像檔</p>
    <button id="restartBtn" class="btn btn-danger" onclick="doRestart()">重啟 Deployment</button>
    <div id="restartMsg"></div>
  </div>

  <!-- Resources Card -->
  <div class="card">
    <div class="toolbar">
      <h2>Pod 資源使用量</h2>
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" onclick="loadResources()">重新整理</button>
    </div>
    <div id="resourceContent" class="status-box loading">載入中...</div>
  </div>

  <!-- Logs Card -->
  <div class="card" id="logsCard" style="display:none;">
    <div class="toolbar">
      <h2>Pod Log</h2>
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" onclick="loadLogs()">重新整理</button>
    </div>
    <div id="logContent" class="log-box loading">載入中...</div>
  </div>
</div>

<script>
async function api(method, url) {
  try {
    const res = await fetch(url, { method });
    return await res.json();
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function loadStatus() {
  const el = document.getElementById('statusContent');
  const badge = document.getElementById('statusBadge');
  el.textContent = '載入中...';
  const data = await api('GET', '/api/status');
  if (data.success) {
    el.textContent = '=== Deployment ===\\n' + data.deployment + '\\n\\n=== Pods ===\\n' + data.pods;
    badge.className = 'badge badge-green';
    badge.textContent = '正常';
  } else {
    el.textContent = data.deployment || '無法取得狀態';
    badge.className = 'badge badge-red';
    badge.textContent = '異常';
  }
}

async function doRestart() {
  if (!confirm('確定要重啟此 Deployment？服務將會短暫離線。')) return;
  const btn = document.getElementById('restartBtn');
  const msg = document.getElementById('restartMsg');
  btn.disabled = true;
  btn.textContent = '重啟中...';
  msg.innerHTML = '';
  const data = await api('POST', '/api/restart');
  btn.disabled = false;
  btn.textContent = '重啟 Deployment';
  msg.innerHTML = '<div class="msg ' + (data.success ? 'msg-ok' : 'msg-err') + '">' + data.message + ' (' + data.timestamp + ')</div>';
  if (data.success) setTimeout(loadStatus, 3000);
}

async function loadResources() {
  const el = document.getElementById('resourceContent');
  el.textContent = '載入中...';
  const data = await api('GET', '/api/resources');
  el.textContent = data.data || '無資料';
  el.className = 'status-box';
}

async function loadLogs() {
  const el = document.getElementById('logContent');
  el.textContent = '載入中...';
  const data = await api('GET', '/api/logs');
  el.textContent = data.logs || '無日誌';
  el.className = 'log-box';
  el.scrollTop = el.scrollHeight;
}

// Initial load
loadStatus();
loadResources();
if (new URLSearchParams(window.location.search).get('logs') === 'true') {
  document.getElementById('logsCard').style.display = '';
  loadLogs();
}
</script>
</body>
</html>`;
