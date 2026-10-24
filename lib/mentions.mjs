/** 评论 @ 配置及情境策略；这里不产生随机数，也不调用大模型。 */
export function parseMentionTargets(input = '', legacyName = '') {
  const raw = String(input || '').trim() || String(legacyName || '').trim()
  const seen = new Set()
  const out = []
  for (const line of raw.split(/[\r\n,，;；]+/)) {
    const [namePart = '', idPart = ''] = line.trim().split('|')
    const name = namePart.replace(/^@/, '').trim()
    if (!name || name.length > 40 || /[<>\r\n]/.test(name) || seen.has(name)) continue
    const uid = /^\d{1,20}$/.test(idPart.trim()) && Number(idPart.trim()) > 0 ? idPart.trim() : ''
    out.push({name, uid})
    seen.add(name)
    if (out.length >= 8) break
  }
  return out
}

/** 用户策略拥有最高优先级。AI 必须显式给出 true 才会触发情境 @。 */
export function decideMentions({ mode = 'ai', isReply = false, shouldMention = false, selectedNames = [], targets = [], position = 'end' } = {}) {
  const validMode = ['off', 'ai', 'ai_select', 'always'].includes(mode) ? mode : 'ai'
  const names = new Set(Array.isArray(selectedNames) ? selectedNames.filter(x=>typeof x==='string').map(x=>x.trim().replace(/^@/,'')) : [])
  const permitted = validMode === 'ai_select' ? targets.filter(x=>names.has(x.name)) : targets
  const should = !isReply && permitted.length > 0 &&
    (validMode === 'always' || (['ai','ai_select'].includes(validMode) && shouldMention === true))
  const validPosition = ['start', 'middle', 'end'].includes(position) ? position : 'end'
  return { shouldMention: should, targets: should?permitted:[], position: validPosition }
}

/** 纯字符串插入；在宿主和测试中复用。真实 UID 传递由 Python MCP 执行。 */
export function composeMentionComment(text, targets = [], shouldMention = false, position = 'end') {
  let body = String(text ?? '').trim()
  for (const {name} of targets) {
    // 屏蔽模型提前拼接的名单，避免用户关闭 @ 后仍然被点名
    body = body.split(`@${name}`).join('').replace(/ {2,}/g, ' ').trim()
  }
  if (!shouldMention || !targets.length) return {text: body, mentions: []}
  const tags = targets.map(t => `@${t.name}`).join(' ')
  const p = ['start', 'middle', 'end'].includes(position) ? position : 'end'
  if (p === 'start') return {text:`${tags} ${body}`.trim(), mentions:targets}
  if (p === 'middle') {
    const match = /[，。！？!?；;]/.exec(body)
    if (match && match.index >= 2 && match.index < body.length - 2) {
      const at = match.index + match[0].length
      return {text:`${body.slice(0, at)} ${tags} ${body.slice(at).trimStart()}`, mentions: targets}
    }
  }
  return {text:`${body} ${tags}`.trim(), mentions:targets}
}
