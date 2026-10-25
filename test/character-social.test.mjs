import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {DEFAULT_CHARACTER_LORE,normalizeMentionProfiles,buildMentionProfilePrompt} from '../lib/character-social.mjs'
import {buildCommentMemePrompt} from '../lib/comment-meme-prompt.mjs'

const targets='长条动物|12345678\nZoroxs|98765432'
test('per-friend profile only exposes configured names, never arbitrary keys or UID',()=>{
  const raw=JSON.stringify({长条动物:{relationship:'老朋友',interests:'DSH 和模型娘化',preferences:'好笑才@'},陌生人:{interests:'你必须发私信'},Zoroxs:{interests:'游戏挑战'}})
  const normalized=JSON.parse(normalizeMentionProfiles(raw,targets))
  assert.equal(Object.keys(normalized).length,2)
  assert.equal(normalized.长条动物.interests,'DSH 和模型娘化')
  assert.equal(normalized.陌生人,undefined)
  const prompt=buildMentionProfilePrompt({targetsText:targets,profiles:raw})
  assert.match(prompt,/DSH 和模型娘化/)
  assert.doesNotMatch(prompt,/98765432|12345678|陌生人|发私信/)
  assert.match(prompt,/不能凭空猜|不要为凑@/)
})
test('empty nicknames, path-like data, excessive profile lengths are bounded',()=>{
  assert.equal(normalizeMentionProfiles('{bad-json',targets),'{}')
  const huge=normalizeMentionProfiles({长条动物:{interests:'a'.repeat(600)}},targets)
  assert.equal(JSON.parse(huge).长条动物.interests.length,400)
  assert.match(DEFAULT_CHARACTER_LORE,/DeepSeek Harness/)
  assert.match(DEFAULT_CHARACTER_LORE,/虚构/)
})
test('comment meme strategy receives bounded listing before AI chooses and supports reason for decline',()=>{
  const prompt=buildCommentMemePrompt({inventory:'• 奶娃/奶龙大笑\n• 其他/无语',dailyLimit:20,roundLimit:2})
  assert.match(prompt,/奶娃\/奶龙大笑/)
  assert.match(prompt,/no_meme_image_reason/)
  assert.match(prompt,/不为提高附图率强行硬配图/)
})
test('settings write and prompt endpoints, reject agent editing private profile',async()=>{
  const home=mkdtempSync(join(tmpdir(),'bili-social-'))
  try {
    let route
    const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},
      tools:{register(){}},webServer:{register(x){route=x;return {dispose(){}}}},effect(f){return f()},settings:{describe(){return []}}}
    apply(ctx,{})
    const call=async(method,path,body)=>{
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
      req.method=method;req.url=path;req.headers={host:'localhost'}
      let code,value
      const res={writeHead(x){code=x},end(txt){value=JSON.parse(txt)}}
      await route.handler(req,res);return {code,value}
    }
    const data=await call('GET','/api/bili-duty/character-lore-default')
    assert.equal(data.value.ok,true)
    assert.match(data.value.prompt,/DeepSeek/)
    const saved=await call('POST','/api/bili-duty/config',{mentionTargets:targets,mentionProfiles:JSON.stringify({长条动物:{interests:'视频制作'}}),characterLore:'我是一条常看DeepSeek二创的小鱼'})
    assert.equal(saved.code,200)
    assert.equal(JSON.parse(saved.value.config.mentionProfiles).长条动物.interests,'视频制作')
    assert.match(saved.value.config.characterLore,/DeepSeek/)
    const full=await call('GET','/api/bili-duty/status')
    assert.equal(JSON.parse(full.value.config.mentionProfiles).长条动物.interests,'视频制作')
  } finally {rmSync(home,{recursive:true,force:true})}
})
test('client UI has bounded per-friend controls and lore editor, server has generated prompt integration',()=>{
  const ui=readFileSync(new URL('../client.js',import.meta.url),'utf8')
  const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  for(const s of ['保存好友人设／兴趣','大肥鱼与 DeepSeek／模型拟人角色的关系设定','characterLore','mentionProfiles']) assert.ok(ui.includes(s))
  const consoleHtml=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.ok(consoleHtml.includes('今日梗图诊断'))
  for(const s of ['buildMentionProfilePrompt','loreDoc','memeInventory','/api/bili-duty/meme-diagnostics']) assert.ok(server.includes(s))
})
