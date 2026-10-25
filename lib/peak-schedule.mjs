/** 自定义自动刷时间段：只有使用者明确保存的窗口才会被调度。 */
import { inWindow } from './state.mjs'

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export const MAX_PEAK_WINDOWS = 16
export const DEFAULT_PEAK_INTERVAL_MINUTES = 30 // 默认值，不是最小值

/** 严格解析保存请求；格式错就报错，避免静默替换既有时间段。 */
export function parsePeakWindows(input) {
  let windows = input
  if (typeof input === 'string') {
    try { windows = JSON.parse(input) } catch { throw new Error('时间段不是有效 JSON') }
  }
  if (!Array.isArray(windows)) throw new Error('时间段必须是数组')
  if (windows.length > MAX_PEAK_WINDOWS) throw new Error(`最多配置 ${MAX_PEAK_WINDOWS} 个时间段`)
  return windows.map((window, i) => {
    if (!window || typeof window !== 'object' || Array.isArray(window)) throw new Error(`第 ${i + 1} 个时间段无效`)
    const start = window.start, end = window.end
    if (typeof start !== 'string' || typeof end !== 'string' || !TIME.test(start) || !TIME.test(end))
      throw new Error(`第 ${i + 1} 个时间段请输入 HH:MM 格式的有效时间`)
    if (start === end) throw new Error(`第 ${i + 1} 个时间段起止时间不能相同`)
    return { start, end }
  })
}

/** 配置读取失败时不激活任何自动窗口，旧版固定中午/夜间模式不会隐式迁移。 */
export function readPeakWindows(input) {
  try { return parsePeakWindows(input) } catch { return [] }
}

/** 支持跨午夜；匹配电脑本地时钟，不按地区套固定峰谷价格时间。 */
export function activePeakWindow(now, windows) {
  return (Array.isArray(windows) ? windows : []).findIndex(window => inWindow(now, window))
}

/** 上一轮真正启动之后至少间隔 N 分钟；不存在 0=旧版每日一次的模式。 */
export function shouldRunWindow({ now = new Date(), intervalMinutes = DEFAULT_PEAK_INTERVAL_MINUTES, lastRunAt } = {}) {
  const minutes = Number(intervalMinutes)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720)
    return { allowed: false, reason: 'invalid_interval' }
  const stamp = lastRunAt ? Date.parse(String(lastRunAt)) : NaN
  if (Number.isFinite(stamp)) {
    const elapsed = now.getTime() - stamp
    if (elapsed < 0) return { allowed: false, reason: 'future_timestamp' }
    if (elapsed < minutes * 60_000) return { allowed: false, reason: 'interval_not_elapsed' }
  }
  return { allowed: true, reason: 'interval_elapsed' }
}
