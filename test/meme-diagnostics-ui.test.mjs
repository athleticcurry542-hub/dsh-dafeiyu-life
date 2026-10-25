import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {listCommentMemes} from '../lib/comment-meme-library.mjs'
import {buildCommentMemePrompt} from '../lib/comment-meme-prompt.mjs'

const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')

test('本轮提示词实际预载分类梗图清单，并允许自定义规则',()=>{
  const home=mkdtempSync(join(tmpdir(),'bili-memelist-'))
  try{
    mkdirSync(join(home,'奶娃'),{recursive:true})
    writeFileSync(join(home,'奶娃','奶龙大笑.webp'),Buffer.from('RIFFdummyWEBP'))
    const library=listCommentMemes(home,{limit:30})
    assert.deepEqual(library.names,['奶娃/奶龙大笑'])
    const text=buildCommentMemePrompt({library,customPrompt:'优先挑选和吐槽配合的图，不能硬塞。'})
    assert.match(text,/奶娃\/奶龙大笑/)
    assert.match(text,/no_meme_reason/)
    assert.match(text,/本轮启动时核对/)
    assert.match(text,/不可信标签/)
    assert.match(text,/优先挑选和吐槽配合/)
    assert.ok(!text.includes('RIFFdummy'))
    assert.match(server,/library: listCommentMemes\(join\(stateDir,'comment-memes'\)/)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('今日梗图诊断只读取固定日期 JSONL，统计发送和图片结果，UI 限高',async()=>{
  const home=mkdtempSync(join(tmpdir(),'bili-meme-diag-'))
  try{
    let route
    const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},
      tools:{register(){}},webServer:{register(spec){route=spec;return {dispose(){}}}},effect(cb){return cb()},settings:{describe(){return []}}}
    apply(ctx,{})
    const day=new Date().toLocaleDateString('sv-SE') // local date in test env
    const folder=join(home,'bili-duty','comment-meme-diagnostics')
    mkdirSync(folder,{recursive:true})
    const lines=[
      {day,bvid:'BV1234567890',success:true,status:'ai_skipped',ai_reason:'和图库表情不搭'},
      {day,bvid:'BV1234567891',success:true,status:'submitted_unverified',upload_attempted:true,image:'奶娃/大笑'},
      {day,bvid:'BV1234567892',success:false,status:'uncertain_no_retry',upload_attempted:true},
      {day,bvid:'invalid',success:true,status:'submitted_unverified'},
    ]
    writeFileSync(join(folder,day+'.jsonl'),lines.map(x=>JSON.stringify(x)).join('\n'),'utf8')
    const req=Readable.from([]);req.method='GET';req.url='/api/bili-duty/comment-meme-diagnostics';req.headers={host:'localhost'}
    let status,value
    const res={writeHead(s){status=s},end(data){value=JSON.parse(data)}}
    await route.handler(req,res)
    assert.equal(status,200)
    assert.equal(value.ok,true)
    assert.equal(value.total,2)
    assert.equal(value.attached,1)
    assert.equal(value.notAttached,1)
    assert.equal(value.uploadAttempts,2)
    assert.equal(value.failed,1)
    assert.equal(value.recent.length,3)
    assert.match(client,/今日梗图诊断/)
    assert.match(client,/memeDiagnosticsExpanded\?'220px'/)
    assert.match(client,/memeDiagnostics\.recent\.slice\(0,3\)/)
  }finally{rmSync(home,{recursive:true,force:true})}
})
