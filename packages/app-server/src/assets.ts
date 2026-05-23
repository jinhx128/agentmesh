export const STUDIO_HTML = `<!doctype html>
<html lang="zh-Hans">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentMesh</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="fallback-shell" data-studio-section="studio-fallback">
      <section class="fallback-panel">
        <p class="fallback-kicker">AgentMesh</p>
        <h1>正在等待 AgentMesh 资源</h1>
        <p>
          当前服务已启动。生产桌面版和 Web UI 使用 Vite 构建产物；
          未提供 assetDir 时仅显示这个最小 fallback。
        </p>
      </section>
    </main>
    <script type="module" src="/studio.js"></script>
  </body>
</html>`;

export const STUDIO_CSS = `:root {
  color: #172033;
  background: #f5f7fb;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  min-height: 100%;
  margin: 0;
}

body {
  display: grid;
  place-items: center;
  padding: 24px;
}

.fallback-shell {
  width: min(680px, 100%);
}

.fallback-panel {
  border: 1px solid #dce3ef;
  border-radius: 12px;
  background: #ffffff;
  padding: 28px;
  box-shadow: 0 18px 40px rgb(23 32 51 / 10%);
}

.fallback-kicker {
  margin: 0 0 8px;
  color: #2f6bd8;
  font-size: 13px;
  font-weight: 800;
}

h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
}

p {
  color: #526074;
  line-height: 1.7;
}`;

export const STUDIO_JS = `document.documentElement.dataset.studioFallback = "minimal";`;
