/**
 * 本地 H5 预览服务 + 测量结果回收（无头浏览器没有 stdout 时用这个拿数据）
 *
 * 【为什么要回收】headless 截图能拿到图，却拿不到页面里量出来的数字：
 *   Edge 命令行在本机版本上 `--dump-dom` 不输出内容，chrome-devtools MCP 也没装 Chrome。
 *   于是让 measure 页在量完后把结果 `fetch POST /report` 上来，服务端落盘成 JSON，
 *   agent 直接读文件 —— 比截图 + 视觉模型 OCR 更准，也不会"把没看到伪装成没问题"。
 *
 * 静态服务部分与 serve-h5.js 同源（SPA 回退 + ENOENT 兜底），另加一个 POST /report。
 *
 * ⚠️ 仅本地预览使用。
 * 用法：node collect-h5.js [port]    默认 8899
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = 'E:/星河宠记/03-源代码/小程序/miniapp/dist-h5'
const PORT = Number(process.argv[2] || 8899)
const OUT = 'E:/星河宠记/02-UI设计/首页优化预览/h5-real/measure-report.json'

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
}

http
  .createServer((req, res) => {
    // ① 测量结果回收：POST /report
    if (req.method === 'POST' && req.url === '/report') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          fs.mkdirSync(path.dirname(OUT), { recursive: true })
          fs.writeFileSync(OUT, body, 'utf8')
          console.log('REPORT SAVED: ' + body.length + ' bytes -> ' + OUT)
        } catch (e) {
          console.error('REPORT WRITE FAILED: ' + e.message)
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('ok')
      })
      return
    }

    // ② 静态文件（SPA 回退）
    let urlPath = decodeURIComponent(req.url.split('?')[0])
    if (urlPath === '/') urlPath = '/index.html'
    let file = path.join(ROOT, urlPath)
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html')
    }
    if (!fs.existsSync(file)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('dist-h5 正在重建，稍后重试')
      return
    }
    const ext = path.extname(file).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    const stream = fs.createReadStream(file)
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    stream.pipe(res)
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log('collect server: http://127.0.0.1:' + PORT + '/')
    console.log('root: ' + ROOT)
    console.log('report -> ' + OUT)
  })
  .on('error', (e) => console.error('server error:', e.message))
process.on('uncaughtException', (e) => console.error('uncaught:', e.message))
