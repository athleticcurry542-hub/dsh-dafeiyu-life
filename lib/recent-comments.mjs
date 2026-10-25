/**
 * Unified local-only comment history for the management center.
 * Older versions only listed strict seen.md table rows. In practice the Agent
 * also writes free-form entries, and the MCP sending tool records successful
 * submissions in mention-diagnostics/*.jsonl even when seen.md is missing.
 * Never claim that a locally accepted submission was publicly visible.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BV = /BV[0-9A-Za-z]{10}/
const EXACT_BV = /^BV[0-9A-Za-z]{10}$/
const ID = /^\d{6,30}$/
const DATE = /20\d{2}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?)?/
const MAX_FILE_BYTES = 6 * 1024 * 1024

function safeRead(file) {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) return ''
    return readFileSync(file, 'utf8')
  } catch { return '' }
}
function names(dir, pattern, max) {
  try { return readdirSync(dir).filter(n => pattern.test(n)).sort().reverse().slice(0, max) }
  catch { return [] }
}
function isoTime(t) {
  const found = DATE.exec(String(t || ''))
  return found ? found[0].replace(' ', 'T') : ''
}
function safeSnippet(value) {
  return String(value || '').replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 120)
}
function idFrom(text) {
  const raw = String(text || '')
  const label = /(?:\brpid\b|评论\s*(?:ID|id))\s*[：:=#\s]*\s*(\d{6,30})/i.exec(raw)
  if (label) return label[1]
  const exact = raw.trim().replace(/^`|`$/g, '')
  return ID.test(exact) ? exact : ''
}
function recordFromSeen(line, inCommentSection) {
  const match = BV.exec(line)
  if (!match) return null
  const bvid = match[0]
  let rpid = '', root = '', snippet = ''
  if (line.trim().startsWith('|')) {
    const cells = line.split('|').map(x => x.trim()).slice(1, -1)
    const bi = cells.findIndex(x => EXACT_BV.test(x))
    if (bi >= 0) {
      rpid = idFrom(cells[bi + 1])
      if (rpid) {
        root = idFrom(cells[bi + 2]) || ''
        if (cells.length > bi + 2) {
          const last = cells[cells.length - 1]
          if (!DATE.test(last) && !ID.test(last) && !/^(?:0|-)$/.test(last)) snippet = safeSnippet(last)
        }
      }
    }
  }
  if (!rpid && (inCommentSection || /(?:rpid|评论\s*(?:ID|id))\s*[=:：#\s]*\d{6,30}/i.test(line))) {
    const tail = line.slice(match.index + bvid.length)
    rpid = idFrom(tail) || (/^[\s|·，,:：-]*(\d{6,30})(?:\b|\s|\|)/.exec(tail)?.[1] || '')
    root = /\broot\s*[:=：]\s*(\d{6,30})/i.exec(tail)?.[1] || ''
    if (!snippet) snippet = safeSnippet(/(?:正文|摘要|内容)\s*[:：]\s*(.+)/.exec(line)?.[1] || '')
  }
  if (!rpid || !ID.test(rpid)) return null
  const time = isoTime(line)
  return {bvid,rpid,root,time,snippet,kind:root?'reply':'top',source:'判重表',hasReceipt:false}
}
function seenEntries(text) {
  const rows = []
  let inCommentSection = false
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim()
    if (/^#{1,6}\s*评论记录/.test(t)) { inCommentSection = true; continue }
    if (/^#{1,6}\s/.test(t)) { inCommentSection = false; continue }
    const row = recordFromSeen(raw, inCommentSection)
    if (row) rows.push(row)
  }
  return rows
}
function diagnosticsEntries(text, filenameDay) {
  const rows = []
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.length > 12_000) continue
    let x
    try { x = JSON.parse(line) } catch { continue }
    if (!x || x.success !== true || !EXACT_BV.test(String(x.bvid || ''))) continue
    const kind = x.kind === 'reply' ? 'reply' : x.kind === 'top' ? 'top' : ''
    if (!kind) continue
    const time = isoTime(x.time) || isoTime(x.day) || filenameDay
    const rpid = ID.test(String(x.rpid || '')) ? String(x.rpid) : ''
    rows.push({bvid:x.bvid,rpid,root:'',time,snippet:'',kind,source:'发送诊断',hasReceipt:true})
  }
  return rows
}

/** @returns {{ok:true,total:number,offset:number,limit:number,days:string[],counts:object,rows:object[],note:string}} */
export function recentComments(stateDir, {limit=50,offset=0,day=''}={}) {
  limit = Math.max(1,Math.min(200,Math.trunc(Number(limit))||50))
  offset = Math.max(0,Math.min(100_000,Math.trunc(Number(offset))||0))
  day = /^20\d{2}-\d{2}-\d{2}$/.test(String(day||'')) ? String(day) : ''
  const byId = new Map()
  const idless = new Map()
  const seenFiles = [join(stateDir,'seen.md'), ...names(join(stateDir,'seen'),/^20\d{2}-\d{2}\.md$/,120).map(x=>join(stateDir,'seen',x))]
  function add(row) {
    if (!EXACT_BV.test(row.bvid)) return
    if (row.rpid) {
      const key = row.bvid + ':' + row.rpid
      const old = byId.get(key)
      if (!old) {byId.set(key,row);return}
      if (!old.snippet && row.snippet) old.snippet = row.snippet
      if (!old.root && row.root) old.root = row.root
      if (row.hasReceipt) { old.hasReceipt = true; old.source = old.source === '判重表' ? '判重表＋发送诊断' : old.source }
      if (!old.time || (row.time.length > old.time.length && row.time.slice(0,10)===old.time.slice(0,10))) old.time = row.time
      if (row.kind === 'reply') old.kind = 'reply'
    } else {
      // A successful tool receipt with no rpid is still useful for completeness,
      // but cannot be verified or confidently joined to a seen.md entry.
      const key = row.bvid + ':' + row.time + ':' + row.kind
      if (!idless.has(key)) idless.set(key,row)
    }
  }
  for (const file of seenFiles) for (const row of seenEntries(safeRead(file))) add(row)
  const diagDir = join(stateDir,'mention-diagnostics')
  for (const file of names(diagDir,/^20\d{2}-\d{2}-\d{2}\.jsonl$/,365)) {
    const dayFromName = file.slice(0,10)
    for (const row of diagnosticsEntries(safeRead(join(diagDir,file)),dayFromName)) add(row)
  }
  // If a legacy row has no timestamp, do not invent a date or manufacture a
  // match with an idless record. Display the uncertainty transparently.
  const all = [...byId.values(),...idless.values()]
  all.sort((a,b)=>(b.time||'').localeCompare(a.time||'') || b.bvid.localeCompare(a.bvid))
  const days = [...new Set(all.map(x=>x.time.slice(0,10)).filter(x=>/^20\d{2}-\d{2}-\d{2}$/.test(x)))].sort().reverse()
  const filtered = day ? all.filter(x=>x.time.startsWith(day)) : all
  const counts = {seen:filtered.filter(x=>x.source.includes('判重表')).length,diagnostic:filtered.filter(x=>x.hasReceipt).length,withoutId:filtered.filter(x=>!x.rpid).length}
  const rows = filtered.slice(offset,offset+limit).map(r=>({bvid:r.bvid,rpid:r.rpid,root:r.root,time:r.time,snippet:r.snippet,kind:r.kind,source:r.source,hasReceipt:r.hasReceipt,
    url:'https://www.bilibili.com/video/'+r.bvid+(r.rpid?'?comment='+encodeURIComponent(r.rpid):'')}))
  return {ok:true,total:filtered.length,offset,limit,days,counts,rows,
    note:'合并本地评论判重表与发送诊断。发送成功仅指工具回执，不等于 B站 已公开展示；未记录的旧评论无法凭空恢复。'}
}
