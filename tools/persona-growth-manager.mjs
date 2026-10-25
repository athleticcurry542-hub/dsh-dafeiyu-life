#!/usr/bin/env node
/** 单机管理页，绑定 127.0.0.1，随机 CSRF token，禁止跨站请求。 */
import http from 'node:http'
import {randomBytes} from 'node:crypto'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {listGrowth,proposeGrowth,reviewGrowth,deleteGrowth,undoGrowth,syncReportsToGrowth,buildGrowthContext} from '../lib/persona-growth.mjs'
const dir=process.env.BILI_DUTY_HOME||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'bili-duty')
const token=randomBytes(24).toString('hex')
const template=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>大肥鱼 · 成长记忆</title>
<style>body{font:15px/1.6 system-ui,"Microsoft Yahei";background:#f4f7fb;color:#202837;max-width:850px;margin:30px auto;padding:0 15px}h1{font-size:26px}section{background:white;padding:22px;border-radius:15px;margin:14px 0;box-shadow:0 1px 6px #dae1ef}button,select,input,textarea{font:inherit}button{padding:5px 12px;margin:4px;border-radius:8px;border:1px solid #c9d4df;cursor:pointer;background:#f7fafc}button.primary{background:#245bd0;color:white;border:0}button.danger{color:#a11}textarea{width:100%;box-sizing:border-box;min-height:86px;border:1px solid #ccd;border-radius:9px;padding:10px}select{padding:7px;border-radius:7px}.meta{font-size:12px;color:#677387}article{border-top:1px solid #e3e8f0;padding:12px 0}.tag{font-size:12px;color:#345;border:1px solid #ccd;border-radius:10px;padding:2px 6px;margin-right:5px}pre{white-space:pre-wrap;word-break:break-word;font-size:13px}#notice{color:#1a5487}</style></head><body>
<h1>🐳 大肥鱼 · 成长记忆</h1><p>核心人设始终由你控制。这里的经验必须经过批准才会进入下一轮 Agent 提示词。视频只是证据，不能自行改变角色设定。</p>
<section><h2>添加你的反馈</h2><p class="meta">例如：评论不要以“这波我笑出声了”收尾；自己被玩梗时不要仅因“没有技术信息”就跳过。</p><select id="kind"><option value="style">评论表达</option><option value="interest">兴趣偏好</option><option value="experience">经验</option><option value="relationship">角色关系观察</option></select><textarea id="body" maxlength="230" placeholder="填写要让大肥鱼学会的一条经验（6–230字）"></textarea><button class="primary" onclick="add()">提交待审核</button></section>
<section><h2>学习与管理</h2><button onclick="sync()">从最近日报提取兴趣候选</button><button onclick="refresh()">刷新</button><button onclick="undo()">撤销上一次修改</button><p class="meta" id="stats"></p><div id="entries">正在读取...</div><p id="notice"></p></section>
<section><h2>当前会注入 Agent 的经验</h2><p class="meta">最多约 1300 字；不重写你的人设。深层角色背景和插件安全规则始终优先。</p><pre id="preview"></pre></section>
<script>const token='__TOKEN__';async function api(path,body){let r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Persona-Growth-Token':token},body:body?JSON.stringify(body):undefined});let v=await r.json();if(!v.ok)throw Error(v.error||'操作失败');return v.data}const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function refresh(){try{const d=await api('list'),p=await api('context');document.getElementById('stats').textContent='条目 '+d.entries.length+' · 已积累视频 '+d.observationCount+' · 修订号 '+d.revision;document.getElementById('preview').textContent=p.text||'目前没有已批准经验。';document.getElementById('entries').innerHTML=d.entries.slice().reverse().map(x=>'<article><span class="tag">'+esc(x.type)+'</span><span class="tag">'+esc(x.status)+'</span><b>'+esc(x.text)+'</b><p class="meta">'+esc(x.source)+' · '+esc(x.evidence)+' · '+esc(x.createdAt)+'</p>'+(x.status==='pending'?'<button data-op="approve" data-id="'+x.id+'">批准</button><button data-op="reject" data-id="'+x.id+'">忽略</button>':'')+'<button class="danger" data-op="delete" data-id="'+x.id+'">删除</button></article>').join('')||'<p>还没有成长经验。</p>'}catch(e){notice(e.message)}}
function notice(s){document.getElementById('notice').textContent=s}
document.getElementById('entries').addEventListener('click',async e=>{let b=e.target.closest('button[data-op]');if(!b)return;try{if(b.dataset.op==='delete'&&!confirm('确定删除这条成长经验？'))return;await api(b.dataset.op,{id:b.dataset.id});notice('已更新');refresh()}catch(e){notice(e.message)}})
async function add(){try{await api('add',{type:document.getElementById('kind').value,text:document.getElementById('body').value});document.getElementById('body').value='';notice('已创建待审核经验');refresh()}catch(e){notice(e.message)}}
async function sync(){try{const d=await api('sync',{});notice('检查了 '+d.files+' 份报告，新增 '+d.added+' 条真实视频观察、'+d.proposals+' 条待审核兴趣');refresh()}catch(e){notice(e.message)}}
async function undo(){try{await api('undo',{});notice('已回退');refresh()}catch(e){notice(e.message)}}refresh()</script></body></html>`
const srv=http.createServer(async(req,res)=>{
 const host=String(req.headers.host||'')
 const origin=req.headers.origin
 const safeHost=/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)
 if(!safeHost||origin && !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin)){res.writeHead(403).end('Forbidden');return}
 if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"}).end(template.replace('__TOKEN__',token));return}
 if(!req.url?.startsWith('/api/')||req.headers['x-persona-growth-token']!==token){res.writeHead(403).end('Forbidden');return}
 let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>12000)throw Error('请求数据太大')}const body=raw?JSON.parse(raw):{}
 const route=req.url.slice(5);let result
 if(req.method==='GET'&&route==='list')result=listGrowth(dir)
 else if(req.method==='GET'&&route==='context')result={text:buildGrowthContext(dir)}
 else if(req.method==='POST'&&route==='add')result=proposeGrowth(dir,{text:body.text,type:body.type})
 else if(req.method==='POST'&&route==='approve')result=reviewGrowth(dir,body.id,'approved')
 else if(req.method==='POST'&&route==='reject')result=reviewGrowth(dir,body.id,'rejected')
 else if(req.method==='POST'&&route==='delete')result=deleteGrowth(dir,body.id)
 else if(req.method==='POST'&&route==='undo')result=undoGrowth(dir)
 else if(req.method==='POST'&&route==='sync')result=syncReportsToGrowth(dir,{limit:15})
 else throw Error('接口不存在')
 res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify({ok:true,data:result}))
 }catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:false,error:e.message}))}
})
srv.listen(Number(process.env.PERSONA_GROWTH_PORT||18763),'127.0.0.1',()=>{
 const port=srv.address().port;console.log(`\n🐳 成长记忆管理页：http://127.0.0.1:${port}/\n数据位置：${dir}\nCtrl+C 可关闭管理页。`)
})
