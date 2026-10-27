/** Portable business-data export/import. Never include login cookies, DPAPI keys or sticker assets. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { validateCommentMemeRules } from './comment-meme-rules.mjs'

export const FORMAT = 'dsh-dafeiyu-life-backup'
const LEGACY_FORMATS = new Set([FORMAT, 'dsh-bili-scroll-plus-backup'])
export const SCHEMA = 1
const MAX_FILE = 4 * 1024 * 1024
const MAX_TOTAL = 32 * 1024 * 1024
const MAX_ITEMS = 3000
const ROOT_FILES = new Set([
  'state.json', 'seen.md', 'duty.md', 'verify-state.json', 'uid-cache.json',
  'comment-meme-rules.json', 'main-session-memory.json',
  'dm-autoreply-state.json', 'comment-interact-state.json', 'comment-ledger-import-v1.json',
])
const DIR_RULES = new Map([
  ['persona-growth',/^(?:v1|previous)\.json$/],
  ['video-wish-claims',/^[a-zA-Z0-9_-]{1,110}--[a-zA-Z0-9_-]{1,110}\.json$/],
  ['seen',/^\d{4}-\d{2}\.md$/],
  ['out',/^\d{4}-\d{2}-\d{2}\.md$/],
  ['reports',/^[\w.-]{1,100}\.(?:md|json)$/],
  ['digest',/^[\w.-]{1,100}\.(?:md|json)$/],
  ['comment-video-context',/^BV[A-Za-z0-9]{10}\.json$/],
  ['mention-diagnostics',/^\d{4}-\d{2}-\d{2}\.jsonl$/],
  ['meme-diagnostics',/^\d{4}-\d{2}-\d{2}\.jsonl$/],
  ['vision-events',/^\d{4}-\d{2}-\d{2}\.jsonl$/],
  ['dynamic-sync',/^[\w.-]{1,100}\.(?:json|jsonl)$/],
  ['long-term-memory',/^[a-zA-Z0-9_-]{1,180}\.json$/],
])
const SQL_PATHS = new Set(['meme-memory.sqlite3', 'public-comment-quota.sqlite3', 'dynamic-sync/dynamic-limit.sqlite3'])

export function allowedPath(path) {
  if (typeof path !== 'string' || path.length > 180 || path.includes('\\') || path.includes('..') || path.startsWith('/')) return false
  const parts = path.split('/')
  if (parts.length === 1) return ROOT_FILES.has(path)
  if (parts.length !== 2) return false
  return !!DIR_RULES.get(parts[0])?.test(parts[1])
}

export function collectBackupFiles(root) {
  const data = {}, stats = { bytes: 0, count: 0 }
  const add = (relative) => {
    if (!allowedPath(relative)) return
    const path = join(root, ...relative.split('/'))
    if (!existsSync(path)) return
    const s = lstatSync(path)
    if (!s.isFile() || s.isSymbolicLink()) return
    if (s.size > MAX_FILE) throw Error('数据文件过大，未进行不完整备份：'+relative)
    stats.bytes += s.size; stats.count++
    if (stats.count > MAX_ITEMS || stats.bytes > MAX_TOTAL) throw Error('业务数据超过单次备份限制（32 MB / 3000 文件），请先归档历史报告')
    data[relative] = readFileSync(path, 'utf8')
  }
  for (const name of ROOT_FILES) add(name)
  for (const [dir, rule] of DIR_RULES) {
    const folder = join(root, dir)
    if (!existsSync(folder) || !lstatSync(folder).isDirectory()) continue
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      if (item.isFile() && rule.test(item.name)) add(dir+'/'+item.name)
    }
  }
  return data
}

export function createBackup({root, config, sqlite = {}, version = ''}) {
  const files = collectBackupFiles(root)
  const backup = {format:FORMAT,schema:SCHEMA,createdAt:new Date().toISOString(),version,
    config:structuredClone(config),files,sqlite,
    exclusions:['表情包图片与素材','B站登录凭证/Cookie','独立密钥','Python环境、模型、缓存与日志','外部 dsh-fish-memory 插件目录（仅内置长期记忆会随本插件备份）']}
  validateBackup(backup)
  return backup
}

export function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) || !LEGACY_FORMATS.has(backup.format) || backup.schema !== SCHEMA) throw Error('不是兼容的大肥鱼数据备份（格式版本不支持）')
  if (!backup.config || typeof backup.config !== 'object' || Array.isArray(backup.config)) throw Error('备份缺少设置项')
  if (!backup.files || typeof backup.files !== 'object' || Array.isArray(backup.files)) throw Error('备份缺少业务数据')
  if (!backup.sqlite || typeof backup.sqlite !== 'object' || Array.isArray(backup.sqlite)) throw Error('备份缺少数据库字段')
  let total = 0, count = 0
  for (const [file, content] of Object.entries(backup.files)) {
    if (!allowedPath(file) || typeof content !== 'string') throw Error('备份包含不允许恢复的路径：'+String(file).slice(0,90))
    const bytes = Buffer.byteLength(content, 'utf8'); total += bytes; count++
    if (bytes > MAX_FILE || total > MAX_TOTAL || count > MAX_ITEMS) throw Error('备份文件内容超过安全限制')
    if (file.startsWith('long-term-memory/')) {
      try {
        const x=JSON.parse(content)
        if (x?.version!==2 || !Array.isArray(x.memories) || !Array.isArray(x.traces) || !Array.isArray(x.deleted) || x.memories.length>5000 || x.deleted.length>1500) throw Error('结构不兼容')
      } catch (e) { throw Error('长期记忆备份无效：'+String(e?.message||e).slice(0,120)) }
    }
  }
  for (const [file, content] of Object.entries(backup.sqlite)) {
    if (!SQL_PATHS.has(file) || typeof content !== 'string' || content.length > 34_000_000 || !/^[A-Za-z0-9+/=]+$/.test(content)) throw Error('SQLite 数据不合法：'+String(file).slice(0,90))
  }
  // Never restore an invalid owner-editable rule set; Python would otherwise refuse to search.
  // Backups from older versions may not contain a custom rule file at all.
  let memeRules = null
  if (Object.hasOwn(backup.files, 'comment-meme-rules.json')) {
    try {
      const content=JSON.parse(backup.files['comment-meme-rules.json'])
      memeRules=validateCommentMemeRules(content).rules.length
    } catch (e) {
      throw Error('表情包检索规则备份无效：'+String(e?.message||e).slice(0,120))
    }
  }
  if (Object.keys(backup.config).length > 300) throw Error('设置字段数量异常')
  return {count, databases:Object.keys(backup.sqlite).length, configKeys:Object.keys(backup.config).length, memeRules, createdAt:backup.createdAt||''}
}

export function restoreBackupFiles(root, backup) {
  validateBackup(backup)
  const tempSuffix = '.backup-import-'+process.pid+'.tmp'
  let count = 0
  for (const [name, content] of Object.entries(backup.files)) {
    const path = join(root, ...name.split('/'))
    const base = dirname(path)
    mkdirSync(base, {recursive:true})
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw Error('目标存在符号链接，拒绝覆盖：'+name)
    const tmp = path + tempSuffix
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, path)
    count++
  }
  return count
}

export function backupSummary(backup) { return validateBackup(backup) }
