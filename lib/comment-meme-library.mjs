/** Read-only, bounded enumeration of user-provided comment memes.
 * Names exposed to an agent are extensionless relative paths, never absolute paths.
 * Nested folder segments are treated as categories, not as instructions.
 */
import {readdirSync, lstatSync} from 'node:fs'
import {join} from 'node:path'

const EXTS = /\.(?:png|jpe?g|gif|webp)$/i
const BAD_SEGMENT = /[\\/\x00-\x1f<>:"|?*]/
const MAX_BYTES = 8 * 1024 * 1024
const MAX_DEPTH = 3
const MAX_SCAN = 300

export function listCommentMemes(folder, {limit = 100, category = '', balanced = false} = {}) {
  const countLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 100)))
  const results = []
  const valid = s => s && s !== '.' && s !== '..' && s.length <= 48 && !BAD_SEGMENT.test(s)
  function walk(dir, dirs) {
    if (results.length >= MAX_SCAN) return
    const children = readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))
    for (const item of children) {
      if (results.length >= MAX_SCAN) break
      if (!valid(item.name) && !EXTS.test(item.name)) continue
      const path = join(dir,item.name)
      let st
      try { st = lstatSync(path) } catch { continue }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory() && dirs.length < MAX_DEPTH && valid(item.name)) {
        walk(path,[...dirs,item.name])
      } else if (st.isFile() && EXTS.test(item.name) && st.size > 0 && st.size <= MAX_BYTES) {
        const stem = item.name.replace(EXTS,'')
        if (!valid(stem)) continue
        const name = [...dirs,stem].join('/')
        if (name.length <= 180) results.push({name,category:dirs[0]||'',file:item.name})
      }
    }
  }
  try {
    if (lstatSync(folder).isSymbolicLink()) throw new Error('表情包库目录不能是符号链接')
    walk(folder,[])
  } catch (err) {
    return {ok:false,names:[],categories:[],total:0,error:String(err?.message||err).slice(0,100)}
  }
  // Two different formats with the same stem in one folder cannot be selected safely.
  const duplicates = new Set()
  const found = new Set()
  for (const row of results) {
    if (found.has(row.name.toLowerCase())) duplicates.add(row.name.toLowerCase())
    found.add(row.name.toLowerCase())
  }
  const unique = results.filter(row=>!duplicates.has(row.name.toLowerCase()))
  const categories = []
  const cats = new Map()
  for (const row of unique) cats.set(row.category,(cats.get(row.category)||0)+1)
  for (const [path,count] of [...cats.entries()].sort((a,b)=>a[0].localeCompare(b[0],'zh-CN'))) {
    categories.push({path, label:path||'根目录', count})
  }
  if (category && !valid(category)) return {ok:false,names:[],categories,total:unique.length,error:'分类名称无效'}
  const filtered = category ? unique.filter(r=>r.category===category) : unique
  let ordered=filtered
  if (balanced && !category) {
    const groups=new Map()
    for(const row of filtered){if(!groups.has(row.category))groups.set(row.category,[]);groups.get(row.category).push(row)}
    ordered=[]
    for(let pos=0;ordered.length<filtered.length;pos++){
      for(const rows of groups.values())if(pos<rows.length)ordered.push(rows[pos])
    }
  }
  return {ok:true,names:ordered.slice(0,countLimit).map(r=>r.name),categories,
    total:unique.length,shown:Math.min(filtered.length,countLimit),truncated:filtered.length>countLimit || results.length>=MAX_SCAN,
    duplicateNames:duplicates.size}
}

/** Preview only a known, unambiguous file in the existing safe library. */
export function getCommentMemePreview(folder,name) {
  const lib=listCommentMemes(folder,{limit:300})
  if(!lib.ok || typeof name!=='string'|| !lib.names.includes(name))return null
  const parts=name.split('/')
  if(parts.length>4 || parts.some(x=>!x||x==='.'||x==='..'||x.length>48||BAD_SEGMENT.test(x)))return null
  let parent=folder
  for(const part of parts.slice(0,-1)){
    parent=join(parent,part)
    const st=lstatSync(parent)
    if(st.isSymbolicLink()||!st.isDirectory())return null
  }
  const candidates=[]
  for(const file of readdirSync(parent)){
    if(!EXTS.test(file)||file.replace(EXTS,'')!==parts.at(-1))continue
    const location=join(parent,file)
    const st=lstatSync(location)
    if(!st.isSymbolicLink()&&st.isFile()&&st.size>0&&st.size<=MAX_BYTES)candidates.push({location,mime:/\.png$/i.test(file)?'image/png':/\.gif$/i.test(file)?'image/gif':/\.webp$/i.test(file)?'image/webp':'image/jpeg'})
  }
  return candidates.length===1?candidates[0]:null
}
