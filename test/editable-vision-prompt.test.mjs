import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DEFAULT_VISION_PROMPT,MAX_VISION_PROMPT_CHARS,normalizeVisionPrompt,buildVisionPrompt} from '../lib/vision-prompt.mjs'
const js=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const isolated=readFileSync(new URL('../lib/vision_dsh.py',import.meta.url),'utf8')

test('默认识图观察规则存在且可由用户自定义，不允许自定义越过硬约束',()=>{
  assert.ok(buildVisionPrompt('').includes(DEFAULT_VISION_PROMPT))
  assert.ok(DEFAULT_VISION_PROMPT.includes('低互动'))
  const custom='遇到陌生视觉梗优先确认角色姿势与眼神，再和已有字幕核对。'
  const p=buildVisionPrompt(custom)
  assert.ok(p.includes(custom))
  assert.ok(!p.includes(DEFAULT_VISION_PROMPT))
  assert.ok(p.includes('真实 JPEG 图片回执'))
  assert.ok(p.includes('每轮最多识图 2 个 BV'))
  assert.equal(normalizeVisionPrompt('A\r\nB\0'),'A\nB')
  assert.equal(normalizeVisionPrompt('x'.repeat(20000)).length,MAX_VISION_PROMPT_CHARS)
})

test('配置端到端：schema、校验、API、UI、日志脱敏和本轮 prompt',()=>{
  assert.match(js,/visionPrompt: z\.string\(\)/)
  assert.match(js,/visionPrompt: ''/)
  assert.match(js,/p\.visionPrompt=normalizeVisionPrompt/)
  assert.match(js,/vision-prompt-default/)
  assert.match(js,/buildVisionPrompt\(cfg\.visionPrompt\)/)
  assert.match(js,/if \('visionPrompt' in args\.patch\) return \{ok:false, blocked:true/)
  assert.match(js,/visionPrompt: '\[识图提示词已更新\]'/)
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const manager=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(html,/视觉识图提示词/)
  assert.match(html,/保存识图提示词/)
  assert.match(html,/vision-prompt-reset/)
  assert.match(manager,/visionPrompt/)
})

test('独立 DSH 识图模型收到用户观察重点，提示词更改会使缓存失效',()=>{
  assert.match(js,/BILI_VISION_PROMPT_B64/)
  assert.match(js,/Buffer\.from\(normalizeVisionPrompt\(cfg\.visionPrompt\)/)
  assert.match(isolated,/BILI_VISION_PROMPT_B64/)
  assert.match(isolated,/prompt_hash=hashlib\.sha256/)
  assert.match(isolated,/d\.get\('prompt_hash'\)==prompt_hash/)
  assert.match(isolated,/'prompt_hash':prompt_hash/)
  assert.match(isolated,/VISION_FAILED/)
  assert.match(isolated,/BILI_VISION_PROOF_FILE/)
})
