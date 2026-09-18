/**
 * 极简静态服务器：用于在浏览器查看 Taro H5 构建产物（dist-h5）
 * 仅本地调试用，不替代任何服务。
 * 用法：node serve-h5.js [port]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/星河宠记/03-源代码/小程序/miniapp/dist-h5';
const PORT = Number(process.argv[2] || 8899);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    let file = path.join(ROOT, urlPath);
    // SPA 回退：找不到文件就回 index.html（Taro H5 是前端路由）
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html');
    }
    // 重建 dist-h5 的瞬间 index.html 会短暂不存在。
    // 原来直接 createReadStream().pipe()，ENOENT 未被捕获 → 整个服务进程崩掉
    // （表现为后续截图全变成十几 KB 的错误页，很隐蔽）。这里显式兜住。
    if (!fs.existsSync(file)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('dist-h5 正在重建，稍后重试');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log('H5 preview server: http://127.0.0.1:' + PORT + '/');
    console.log('root: ' + ROOT);
  })
  // 兜底：任何未捕获异常都不该让预览服务整体挂掉
  .on('error', (e) => console.error('server error:', e.message));
process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
