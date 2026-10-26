import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listCommentMemes, getCommentMemePreview } from '../lib/comment-meme-library.mjs'

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

test('检索规则支持搜索、状态筛选、折叠、分页，保存捕获完整状态而非仅当前 DOM 页',()=>{
  for(const id of ['meme-rule-search','meme-rule-filter','meme-rule-page-size','meme-rule-prev','meme-rule-next','meme-rule-page-status'])assert.ok(html.includes(`id="${id}"`))
  assert.match(js,/const captureMemeRules=\(\)=>\(\{schema:1,rules:ruleSet\.rules\.map/)
  assert.match(js,/const el=node\('details'/)
  assert.match(js,/filtered\.slice\(\(memeRulePage-1\)\*size,memeRulePage\*size\)/)
  assert.match(js,/memeRulesLoaded\?Promise\.resolve\(\):loadMemeRules\(\)/)
})

test('导出所有表情包名基于全部图库数据、不是筛选结果或当前页',()=>{
  assert.ok(html.includes('id="sticker-export-names"'))
  assert.match(js,/const data=await request\('\/stickers'\);/)
  assert.match(js,/const exportItems=data\.items\|\|\[\]/)
  assert.match(js,/exportItems\.map\(s=>s\.name\)/)
  assert.match(js,/大肥鱼表情包名称列表\.txt/)
})

test('合法的长中文表情包名称（64 字符内）不会从图库中丢失',()=>{
  const root=mkdtempSync(join(tmpdir(),'sticker-v2472-'))
  try {
    const category='大肥鱼和其他大模型'
    const stem='DeepSeek娘『'+('内容'.repeat(22))+'』表情包'
    assert.ok(stem.length>48&&stem.length<=64)
    mkdirSync(join(root,category));writeFileSync(join(root,category,stem+'.png'),'png-contents')
    const all=listCommentMemes(root)
    assert.deepEqual(all.names,[category+'/'+stem])
    assert.ok(getCommentMemePreview(root,category+'/'+stem))
  } finally {rmSync(root,{recursive:true,force:true})}
})
