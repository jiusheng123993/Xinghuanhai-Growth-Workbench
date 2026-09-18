/**
 * 重建 dist-h5 里的两个调试页（构建会清空 dist-h5，所以每次 build:h5 后跑一次）
 *
 *   seed.html    —— 写入格式合法的假登录态 + 宠物数据（Taro H5 的 storage 是 { data } 包装）
 *   measure.html —— 把应用装进固定 375px 的 iframe，用于「真实视口」截图与 DOM 测量
 *
 * 【为什么连宠物数据一起种】
 *   受登录守卫保护的页面（宠物档案 / 创作 / 我的…）光有 token 还不够：
 *   petService.getPets 请求失败会回落到本地存储，本地存储空 → 页面渲染成
 *   「还没有添加宠物」守卫态，看不到真实内容，等于没法验收。
 *
 * 【键名的坑】utils/storage 的 getStorage 会用 _currentUserId 再拼一层前缀
 *   （_getKey = `${_currentUserId}_${key}`），而 petService 自己已经拼了
 *   `${PETS_KEY}_${userId}`。两层叠加与否取决于 setStorageUserId 有没有被调用，
 *   所以这里**两种键形态都种一份**，谁命中算谁的。
 *
 * @tarojs/taro-h5/dist/api/storage/index.js:38 —— setStorageSync 写的是
 * localStorage[key] = JSON.stringify({ data })，写裸值会被解析成 undefined。
 *
 * ⚠️ 仅本地 H5 预览使用，不进小程序产物、不连生产接口。
 *
 * 用法：node make-h5-helpers.js
 */
const fs = require('fs')
const path = require('path')

const D5 = 'E:/星河宠记/03-源代码/小程序/miniapp/dist-h5'

/** 种数据脚本片段（seed 与 measure 共用） */
const SEED_JS = `
function obfuscate(d){var k='xhh-secure-storage-v2',o='';for(var i=0;i<d.length;i++)o+=String.fromCharCode(d.charCodeAt(i)^k.charCodeAt(i%k.length));return o}
function b64url(o){return btoa(JSON.stringify(o)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')}
function taroSet(k,v){localStorage.setItem(k,JSON.stringify({data:v}))}
var uid='user_001'
var token=b64url({alg:'HS256',typ:'JWT'})+'.'+b64url({sub:uid,exp:Math.floor(Date.now()/1000)+86400*365})+'.fakesig'
taroSet('xhh_token',btoa(obfuscate(token)))
taroSet('xhh_refresh_token',btoa(obfuscate(token)))
taroSet('xhh_user',JSON.stringify({id:uid,nickname:'小橘的铲屎官',avatar:'',phone:'13800000000',createdAt:''}))

var AV='https://api.xinghuanhai.com/uploads/avatars/home-style'
var pets=[
 {id:'pet_001',userId:'user_001',name:'小橘',species:'cat',breed:'中华田园猫',breedId:'chinese_tabby',
  gender:'male',birthDate:'2023-05-12',weight:4.2,coatColor:'橘色虎斑',
  avatarCartoonUrl:AV+'/cat/cat-01-orange-tabby.png',
  photos:[],isNeutered:true,microchipId:'',notes:'',isDeceased:false,
  allergies:[],medications:[],chronicConditions:[],
  createdAt:'2023-05-12T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'},
 {id:'pet_002',userId:'user_001',name:'旺财',species:'dog',breed:'金毛寻回犬',breedId:'golden_retriever',
  gender:'male',birthDate:'2022-03-08',weight:28,coatColor:'金色',
  avatarCartoonUrl:AV+'/dog/dog-01-golden.png',
  photos:[],isNeutered:false,microchipId:'',notes:'',isDeceased:false,
  allergies:['鸡肉'],medications:[],chronicConditions:[],
  createdAt:'2022-03-08T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'}
]
var petsJson=JSON.stringify(pets)
taroSet('pets_user_001',petsJson)
taroSet('user_001_pets_user_001',petsJson)
`

const SEED = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>seed</title></head><body>
<pre id="out">seeding…</pre>
<script>${SEED_JS}
document.getElementById('out').textContent='SEEDED'
document.title='SEEDED'
var to=new URLSearchParams(location.search).get('to')
if(to)location.replace('/#'+to)
</script></body></html>`

const MEASURE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>measure</title>
<style>body{margin:0;font:12px/1.5 monospace}#wrap{display:flex;gap:12px;padding:8px}
iframe{width:375px;height:812px;border:1px solid #ccc}pre{margin:0;white-space:pre-wrap;max-width:520px}</style>
</head><body>
<div id="wrap"><iframe id="f"></iframe><pre id="out">measuring…</pre></div>
<script>
/* 把应用装进固定 375px 的 iframe，用于 ①真实视口截图 ②DOM 宽度测量。
   起因：直接用 --window-size=375 --force-device-scale-factor=2 截图时，
   页面会按约 208px 视口布局，元素看起来大 ~1.8 倍并"溢出"，
   我据此误判过「创作页横向溢出」——实际 measure 出来 body.scrollWidth=375 根本没有溢出。 */${SEED_JS}
var qs=new URLSearchParams(location.search)
var target=qs.get('to')||'/pages/creative/index'
var f=document.getElementById('f')
f.src='/#'+target
if(qs.get('clean')==='1'){
  document.body.style.background='#fff'
  document.getElementById('out').style.display='none'
  var w=document.getElementById('wrap');w.style.padding='0';w.style.gap='0'
  f.style.border='0';f.style.height=(qs.get('h')||'812')+'px'
}
setTimeout(function(){
  var out=[]
  try{
    var d=f.contentDocument,W=d.documentElement.clientWidth
    out.push('viewport='+W+'  body.scrollWidth='+d.body.scrollWidth)
    out.push('OVERFLOW='+(d.body.scrollWidth>W+1?'YES':'NO'))
    var sels=['.cve','.cve-hero','.cve-grid2','.cve-feat','.cve-mini','.empty-state']
    sels.forEach(function(s){var els=d.querySelectorAll(s);for(var i=0;i<Math.min(els.length,6);i++){
      var b=els[i].getBoundingClientRect()
      out.push(((els[i].className||'')+'').split(' ').slice(0,2).join('.').padEnd(24)+' x='+Math.round(b.x)+' w='+Math.round(b.width)+' right='+Math.round(b.right))}})
  }catch(e){out.push('ERR '+e.message)}
  document.getElementById('out').textContent=out.join('\\n')
  document.title='MEASURED'
},14000)
</script></body></html>`

fs.mkdirSync(D5, { recursive: true })
fs.writeFileSync(path.join(D5, 'seed.html'), SEED, 'utf8')
fs.writeFileSync(path.join(D5, 'measure.html'), MEASURE, 'utf8')
console.log('✅ 已重建 dist-h5/seed.html 与 measure.html（含假登录态 + 2 只宠物）')
