/**
 * 峰谷窗口启动闸门。纯函数：不读取状态或外部配置，方便防回归测试。
 * 默认 0 维持老版每时段每日一次；非 0 使用上次实际启动时间间隔。
 */
export function shouldRunWindow({now = new Date(), windowKey, intervalMinutes = 0, windows = {}, lastRunAt} = {}) {
  const minutes = Number(intervalMinutes) || 0
  if (!Number.isFinite(minutes) || minutes < 0) return { allowed:false, reason:'invalid_interval' }
  if (minutes === 0) {
    return windows && windows[windowKey]
      ? {allowed:false,reason:'already_ran_this_window'}
      : {allowed:true,reason:'legacy_once_per_window'}
  }
  const timestamp = Date.parse(String(lastRunAt || ''))
  if (Number.isFinite(timestamp)) {
    const age = now.getTime() - timestamp
    if (age < 0) return {allowed:false, reason:'future_timestamp'}
    if (age < minutes * 60_000) return {allowed:false,reason:'interval_not_elapsed'}
  }
  return {allowed:true,reason:'interval_elapsed'}
}
