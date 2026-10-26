/** Owner-editable lexical sticker matching rules. No AI, network, or image bytes. */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const RULE_FILE = 'comment-meme-rules.json'
const MAX_RULES = 100
const MAX_SIZE = 100_000
const names = ['triggers', 'targets', 'requireAny', 'excludeAny']
const phrase = text => typeof text === 'string' && text.length >= 1 && text.length <= 38 && !/[\x00-\x1f\x7f]/.test(text)

export function validateCommentMemeRules(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.schema !== 1 || !Array.isArray(body.rules) || body.rules.length > MAX_RULES)
    throw Error('规则格式不正确，最多允许 100 条')
  const ids = new Set()
  const rules = body.rules.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error(`第 ${i+1} 条不是规则对象`)
    if (typeof r.id !== 'string' || !/^[a-z0-9_-]{1,48}$/.test(r.id) || ids.has(r.id)) throw Error(`第 ${i+1} 条 ID 无效或重复`)
    ids.add(r.id)
    if (typeof r.label !== 'string' || !r.label.trim() || r.label.length > 65 || /[\x00-\x1f\x7f]/.test(r.label)) throw Error(`第 ${i+1} 条名称不合法`)
    if (typeof r.enabled !== 'boolean') throw Error(`第 ${i+1} 条的启用状态无效`)
    const parsed = {id:r.id,label:r.label.trim(),enabled:r.enabled}
    for (const k of names) {
      const v = r[k] ?? ((k==='requireAny'||k==='excludeAny') ? [] : null)
      if (!Array.isArray(v) || v.length > 36 || !v.every(phrase) || (['triggers','targets'].includes(k) && !v.length))
        throw Error(`第 ${i+1} 条的 ${k} 必须为最多 36 个有效短语（触发词与目标词不能留空）`)
      parsed[k] = [...new Set(v.map(x=>x.trim()).filter(Boolean))]
      if (['triggers','targets'].includes(k) && !parsed[k].length) throw Error(`第 ${i+1} 条的 ${k} 不能为空`)
    }
    return parsed
  })
  const result = {schema:1,rules}
  if (Buffer.byteLength(JSON.stringify(result),'utf8')>MAX_SIZE) throw Error('规则数据超过 100 KB 安全限制')
  return result
}

export function readCommentMemeRules(root, pluginDir) {
  const custom=join(root,RULE_FILE)
  const fallback=join(pluginDir,'vendor','bilibili-mcp','comment_meme_rules_default.json')
  const path=existsSync(custom) ? custom : fallback
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).size>MAX_SIZE) throw Error('规则文件不安全')
  return {data:validateCommentMemeRules(JSON.parse(readFileSync(path,'utf8'))), customized:path===custom}
}

export function saveCommentMemeRules(root, raw) {
  const data=validateCommentMemeRules(raw)
  mkdirSync(root,{recursive:true})
  const path=join(root,RULE_FILE)
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw Error('目标规则文件是符号链接，拒绝写入')
  const tmp=path+'.tmp-'+process.pid
  writeFileSync(tmp,JSON.stringify(data,null,2)+'\n','utf8')
  renameSync(tmp,path)
  return data
}
