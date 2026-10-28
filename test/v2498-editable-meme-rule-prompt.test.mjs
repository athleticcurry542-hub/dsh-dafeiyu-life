import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_MEME_RULE_AI_PROMPT, MAX_MEME_RULE_AI_PROMPT_CHARS, buildMemeRuleAIUpdatePrompt, normalizeMemeRuleAIPrompt } from '../lib/comment-meme-ai-rules.mjs'
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')

test('规则维护提示词可读、可编辑，默认规则仍与兴趣动态排序解耦',()=>{
  assert.match(DEFAULT_MEME_RULE_AI_PROMPT,/跨角色、相对稳定/)
  assert.match(DEFAULT_MEME_RULE_AI_PROMPT,/当前兴趣不会传入本次规则维护/)
  const rules={schema:1,rules:[]}
  const custom='请优先让规则清晰简短，但不要把当前兴趣写入稳定规则。'
  const prompt=buildMemeRuleAIUpdatePrompt({mode:'full',currentRules:rules,names:['奶娃/疑惑'],customPrompt:custom})
  assert.ok(prompt.startsWith(custom))
  assert.match(prompt,/全量优化/)
  assert.match(prompt,/奶娃\/疑惑/)
  assert.match(prompt,/程序还会强制校验输出 JSON 结构/)
})

test('规则维护提示词清洗控制字符并限制长度',()=>{
  assert.equal(normalizeMemeRuleAIPrompt('A\r\nB\0C'), 'A\nBC')
  assert.equal(normalizeMemeRuleAIPrompt('x'.repeat(MAX_MEME_RULE_AI_PROMPT_CHARS+10)).length,MAX_MEME_RULE_AI_PROMPT_CHARS)
  assert.equal(normalizeMemeRuleAIPrompt(null),'')
})

test('管理中心可编辑/保存/恢复提示词，服务端用已保存提示词并对正文日志脱敏',()=>{
  const html=read('lib/management-console.html'),ui=read('lib/management-console.js'),server=read('index.js')
  for(const id of ['meme-rule-ai-prompt','meme-rule-ai-prompt-save','meme-rule-ai-prompt-reset','meme-rule-ai-prompt-status'])assert.ok(html.includes(`id="${id}"`))
  assert.match(ui,/request\('\/comment-meme-rules\/ai-prompt-default'\)/)
  assert.match(ui,/request\('\/config',isDefault\?/)
  assert.match(ui,/提示词有未保存修改/)
  assert.match(server,/memeRulesPrompt: z\.string\(\)/)
  assert.match(server,/memeRulesPrompt\s*=\s*normalizeMemeRuleAIPrompt/)
  assert.match(server,/customPrompt:cfg\.memeRulesPrompt/)
  assert.match(server,/comment-meme-rules\/ai-prompt-default/)
  assert.match(server,/表情包规则维护提示词已更新/)
})
