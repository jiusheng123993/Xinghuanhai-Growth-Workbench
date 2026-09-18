/**
 * 时光线页「真实 375px 视口」测量页生成器
 *
 * 用途：验证 2026-09-11 的多宠物改动（顶部 PetSwitcher 切换条 + 速览区
 * 「出生天数 / 相伴 N 天」双口径）在真实渲染下的布局与行为，而不是靠看截图猜。
 *
 * 做法与既有 measure.html 一致：把 Taro H5 构建产物装进**固定 375px 的 iframe**
 * （绕开 Edge 命令行 --window-size 的视口 bug），等待应用挂载后：
 *   ① 用 getBoundingClientRect 量各区块的位置/宽度，判断有没有横向溢出、有没有把首屏挤没；
 *   ② 点一下切换条上的第二只宠物，再量一次 —— 验证"切换后整页数字跟着换"真的生效。
 *
 * 假登录态与宠物数据直接复用 make-h5-helpers.js 里的 SEED_JS（不复制一份，避免两边漂移），
 * 只把「小橘」的建档时间改晚，让"出生天数"和"相伴天数"是两个不同的数字，便于肉眼核对。
 *
 * ⚠️ 仅本地 H5 预览使用，不进小程序产物、不连生产接口（本地存储回落）。
 * 用法：node measure-timeline.js   然后 serve-h5.js 起服务，浏览器访问 measure-timeline.html
 */
const fs = require('fs')
const path = require('path')

const D5 = 'E:/星河宠记/03-源代码/小程序/miniapp/dist-h5'

// 从 make-h5-helpers.js 里取出 SEED_JS 模板字符串的真实值（用 new Function 求值，保留原有转义语义）
const helperSrc = fs.readFileSync(path.join(__dirname, 'make-h5-helpers.js'), 'utf8')
const captured = /const SEED_JS = `([\s\S]*?)`\r?\n/.exec(helperSrc)
if (!captured) throw new Error('未能从 make-h5-helpers.js 提取 SEED_JS')
let SEED_JS = new Function('return `' + captured[1] + '`')()

// 让小橘「出生 2023-05-12、建档 2025-06-01」——两个天数会明显不同，方便验证 UI 同时展示两个口径
SEED_JS = SEED_JS.replace(
  "createdAt:'2023-05-12T00:00:00.000Z'",
  "createdAt:'2025-06-01T00:00:00.000Z'",
)

const HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>measure-timeline</title>
<style>body{margin:0;font:12px/1.5 monospace}#wrap{display:flex;gap:12px;padding:8px}
iframe{width:375px;border:1px solid #ccc}pre{margin:0;white-space:pre-wrap;max-width:560px}</style>
</head><body>
<div id="wrap"><iframe id="f"></iframe><pre id="out">measuring…</pre></div>
<script>${SEED_JS}
var qs=new URLSearchParams(location.search)
var f=document.getElementById('f')
f.style.height=(qs.get('h')||'812')+'px'
f.src='/#/pages/timeline/index'

/** 量一次：区块位置 + 速览三格 + 格内文字是否被挤破 */
function measure(tag){
  var out=[]
  try{
    var d=f.contentDocument, W=d.documentElement.clientWidth
    out.push('['+tag+'] viewport='+W+' body.scrollWidth='+d.body.scrollWidth+' OVERFLOW='+(d.body.scrollWidth>W+1?'YES':'NO'))
    var blocks=['.timeline-page','.pet-switcher','.pet-switcher__list','.timeline-fixed-top','.page-hero','.timeline-scroll','.timeline-overview']
    blocks.forEach(function(sel){
      var el=d.querySelector(sel)
      if(!el){out.push('  '+sel+' = (缺失)');return}
      var b=el.getBoundingClientRect()
      out.push('  '+sel+' x='+Math.round(b.x)+' y='+Math.round(b.y)+' w='+Math.round(b.width)+' h='+Math.round(b.height)+' right='+Math.round(b.right))
    })
    var items=d.querySelectorAll('.timeline-overview-item')
    for(var i=0;i<items.length;i++){
      var b=items[i].getBoundingClientRect()
      var t=(items[i].textContent||'').replace(/\\s+/g,' ').trim()
      out.push('  item['+i+'] x='+Math.round(b.x)+' w='+Math.round(b.width)+' right='+Math.round(b.right)+' h='+Math.round(b.height)+' text="'+t+'"')
    }
    var texts=d.querySelectorAll('.timeline-overview-value,.timeline-overview-label,.timeline-overview-sub')
    for(var j=0;j<texts.length;j++){
      var s=texts[j]
      out.push('  .'+String(s.className).split(' ')[0]+' "'+(s.textContent||'').trim()+'" w='+Math.round(s.getBoundingClientRect().width)+' scrollW='+s.scrollWidth+' 溢出='+(s.scrollWidth>s.clientWidth+1?'YES':'NO'))
    }
    var names=d.querySelectorAll('.pet-switcher__name'), list=[]
    for(var k=0;k<names.length;k++)list.push((names[k].textContent||'').trim())
    out.push('  切换条宠物: '+(list.join(' / ')||'(空)'))
  }catch(e){out.push('  ERR '+e.message)}
  return out.join('\\n')
}

/**
 * 把测量结果 POST 回本地服务（collect-h5.js 会落盘成 JSON）
 * 无头浏览器拿不到 stdout（--dump-dom 在本机 Edge 上不输出），所以走这条回收通道。
 * 必须用**同步** XHR：virtual-time 预算一到浏览器立刻退出，异步 fetch 会被拦腰截断
 * （上一版就是这么丢数据的，服务端一条都没收到）。
 */
function report(txt){
  try{
    var x=new XMLHttpRequest()
    x.open('POST','/report',false)
    x.send(txt)
    document.title='REPORTED'
  }catch(e){
    document.title='REPORT_FAILED'
  }
}

var log=[]
setTimeout(function(){
  log.push(measure('初始（第一只宠物）'))
  var items=f.contentDocument.querySelectorAll('.pet-switcher__item')
  if(items.length>1){
    items[1].click()
    setTimeout(function(){
      log.push(measure('点第二只后'))
      document.getElementById('out').textContent=log.join('\\n')
      report(log.join('\\n'))
      document.title='MEASURED'
    },4500)
  }else{
    log.push('  ⚠️ 切换条里没有第二只宠物，跳过切换验证')
    document.getElementById('out').textContent=log.join('\\n')
    report(log.join('\\n'))
    document.title='MEASURED'
  }
},13000)
</script></body></html>`

fs.mkdirSync(D5, { recursive: true })
fs.writeFileSync(path.join(D5, 'measure-timeline.html'), HTML, 'utf8')
console.log('✅ 已生成 dist-h5/measure-timeline.html')
