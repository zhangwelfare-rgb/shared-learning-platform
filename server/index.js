'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { dispatch } = require('./routes');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // API
  if (url.pathname.startsWith('/api/')) {
    let body = '';
    try {
      for await (const chunk of req) body += chunk;
    } catch (e) { /* 忽略读取错误 */ }
    let parsed = null;
    try { parsed = body ? JSON.parse(body) : null; } catch (e) { parsed = null; }
    return await dispatch(req, res, parsed, url);
  }

  // 静态资源 + SPA 回退
  let fp = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fp.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) fp = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
});

server.listen(config.PORT, () => {
  console.log(`✅ 智学论坛 · 自学习智能体 已启动: http://localhost:${config.PORT}`);
  if (!config.DEEPSEEK_API_KEY) {
    console.log('ℹ️  未配置 DEEPSEEK_API_KEY，已启用学科模板兜底（仍可完整离线运行）。');
  }
});
