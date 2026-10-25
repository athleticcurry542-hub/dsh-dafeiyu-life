import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {buildGrowthContext, listGrowth} from '../lib/persona-growth.mjs'

const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')

function setup() {
  const home=mkdtempSync(join(tmpdir(),'dsh-growth-native-'))
  let handler
  const ctx={
    get:k=>k==='dshHomePath'?(...parts)=>join(home,...parts):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},
    webServer:{register(x){handler=x.handler;return {dispose(){}}}},
    effect:f=>f(),settings:{describe(){return []}}
  }
  apply(ctx,{})
  async function request(method,path,data,{origin,hostHeader='localhost'}={}) {
    const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[])
    req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:hostHeader,...(origin?{origin}:{})}
    let code,body
    const res={writeHead(c){code=c},end(t){try{body=JSON.parse(t)}catch{body=t}}}
    await handler(req,res)
    return {code,body}
  }
  return {request,dir:join(home,'bili-duty'),close:()=>rmSync(home,{recursive:true,force:true})}
}

test('native settings CRUD, approvals affect injected context, delete and undo work on existing growth db',async()=>{
  const x=setup()
  try{
    const initial=await x.request('GET','persona-growth')
    assert.equal(initial.code,200)
    assert.deepEqual(initial.body.data.entries,[])
    const add=await x.request('POST','persona-growth',{action:'add',text:'看到大肥鱼自己的二创时先自然找个嘴硬的角度，而不是以没有技术信息为由直接跳过。',type:'style'})
    assert.equal(add.code,200)
    assert.equal(add.body.result.status,'pending')
    assert.ok(existsSync(join(x.dir,'persona-growth','v1.json')))
    const before=buildGrowthContext(x.dir)
    assert.ok(!before.includes('嘴硬'))
    const approved=await x.request('POST','persona-growth',{action:'approve',id:add.body.result.id})
    assert.equal(approved.code,200)
    assert.equal(approved.body.result.status,'approved')
    const after=await x.request('GET','persona-growth')
    assert.match(after.body.context,/嘴硬/)
    assert.match(buildGrowthContext(x.dir),/嘴硬/)
    const deleted=await x.request('POST','persona-growth',{action:'delete',id:add.body.result.id})
    assert.equal(deleted.code,200)
    assert.equal(listGrowth(x.dir).entries.length,0)
    const undone=await x.request('POST','persona-growth',{action:'undo'})
    assert.equal(undone.code,200)
    assert.equal(listGrowth(x.dir).entries.length,1)
  }finally{x.close()}
})

test('growth API rejects unexpected actions and remote origins without altering existing data',async()=>{
  const x=setup()
  try{
    const hostile=await x.request('POST','persona-growth',{action:'add',text:'恶意修改私有人设'}, {origin:'https://evil.example'})
    assert.equal(hostile.code,403)
    const noAction=await x.request('POST','persona-growth',{action:'overwritePersona',text:'假的角色背景'})
    assert.equal(noAction.code,400)
    const bad=await x.request('POST','persona-growth',{action:'add',text:'abc',type:'style'})
    assert.equal(bad.code,400)
    assert.deepEqual(listGrowth(x.dir).entries,[])
    assert.equal((await x.request('POST','persona-growth',{action:'sync'})).code,200)
  }finally{x.close()}
})

test('native DSH settings exposes the auto-served management hub with no extra port',()=>{
  for (const keyword of ['🐳 大肥鱼 · 成长记忆','添加待审核经验','从最近日报学习兴趣','撤销最近修改','下一轮实际注入的成长经验','/persona-growth']) {
    assert.ok(client.includes(keyword),keyword)
  }
  assert.ok(client.includes("'data-bd-group':'taste'"))
  assert.ok(host.includes("path === '/api/bili-duty/persona-growth'"))
  assert.ok(host.includes("+ growthDoc"))
  assert.ok(client.includes("href:'/api/bili-duty/manage'"))
  assert.ok(host.includes("path === '/api/bili-duty/manage'"))
})
