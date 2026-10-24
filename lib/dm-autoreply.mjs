/**
 * dsh-bili-scroll-plus: DM one-shot strangers + unlimited whitelist conversations.
 * Transport/LLM neutral: callers MUST supply authenticated Bilibili fetch/send
 * adapters and a DSH-backed generateReply adapter.
 *
 * fetchIncoming() -> [{ senderUid, messageId, timestampMs, text, incoming:true }]
 * - Return only private, user-to-account chat messages (not system notifications).
 * - messageId must be stable across polls; timestampMs must be an epoch ms integer.
 * send({uid, text}) -> {ok:true} or true (throws or {ok:false} on failure).
 * generateReply({uid, text, history, messages}) -> string.
 */
import { mkdir, open, readFile, rename, writeFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_STRANGER_TEXT = '你好，我是这个账号的 AI 助手，已收到你的私信。陌生用户暂时只能收到这一条自动回复；请不要发送密码、验证码等敏感信息。';
const clamp = (n, lo, hi, fallback) => Number.isFinite(+n) ? Math.max(lo, Math.min(hi, Math.round(+n))) : fallback;
const cleanUid = (uid) => { const s = String(uid ?? '').trim(); return /^[1-9]\d{0,18}$/.test(s) ? s : ''; };
const cleanString = (value, max) => String(value ?? '').slice(0, max);
function resolveOptions(config = {}) {
  const rawList = Array.isArray(config.whitelist) ? config.whitelist : String(config.whitelist || '').split(/[\s,，;；]+/);
  const whitelist = new Set(rawList.map(cleanUid).filter(Boolean));
  return {
    enabled: config.enabled === true,
    strangerEnabled: config.strangerEnabled === true,
    whitelist,
    strangerText: cleanString(config.strangerText || DEFAULT_STRANGER_TEXT, 450),
    intervalMs: clamp(config.intervalMinutes, 1, 120, 1) * 60_000,
    maxPerPoll: clamp(config.maxPerPoll, 1, 20, 3),
    maxPerHour: clamp(config.maxPerHour, 1, 120, 60),
    maxPerDay: clamp(config.maxPerDay, 0, 1000, 0),
    whitelistCooldownMs: clamp(config.whitelistCooldownSeconds, 0, 600, 20) * 1000,
    historyLimit: clamp(config.historyLimit, 2, 40, 16),
  };
}
const fresh = () => ({ version: 1, initialized: false, people: {}, sentAt: [] });
const validIncoming = (row, me) => {
  if (!row || row.incoming !== true || row.system === true) return null;
  const uid = cleanUid(row.senderUid);
  if (!uid || uid === me) return null;
  const id = cleanString(row.messageId, 150);
  const time = Number(row.timestampMs);
  if (!id || !Number.isSafeInteger(time) || time <= 0) return null;
  return { uid, id, time, text: cleanString(row.text, 4000) };
};
const personOf = (db, uid) => (db.people[uid] ??= { seen: [], history: [], lastRepliedAt: 0, stranger: null });
function markSeen(person, msg) {
  if (!person.seen.includes(msg.id)) person.seen.push(msg.id);
  if (person.seen.length > 500) person.seen.splice(0, person.seen.length - 500);
}

export function createDmAutoReply({ dataDir, fetchIncoming, send, generateReply, getConfig, selfUid = '', logger = console, now = Date.now }) {
  if (!dataDir || typeof fetchIncoming !== 'function' || typeof send !== 'function' || typeof getConfig !== 'function') {
    throw new TypeError('dataDir, fetchIncoming, send, getConfig are required');
  }
  const file = join(dataDir, 'dm-autoreply-state.json');
  const lockFile = join(dataDir, 'dm-autoreply.lock');
  let polling = false;
  let stopped = true;
  let timer;
  let lastError = '';
  let lastPollAt = 0;
  let lock = null;

  const persist = async (db) => {
    const tmp = join(dataDir, `dm-autoreply-state.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 });
      await rename(tmp, file);
    } catch (err) { await unlink(tmp).catch(() => {}); throw err; }
  };
  const load = async () => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed?.version === 1 && parsed.people && Array.isArray(parsed.sentAt)) return parsed;
      throw new Error('unknown state format');
    } catch (e) {
      if (e.code === 'ENOENT') return fresh();
      throw e; // never reset on corruption: could cause duplicate stranger replies
    }
  };
  const enterLock = async () => {
    try { lock = await open(lockFile, 'wx', 0o600); await lock.writeFile(`${process.pid}\n`); return true; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Recover only *clearly stale* locks. Never remove a live process' lock:
      // otherwise two DSH instances could send the same first reply.
      const age = await stat(lockFile).then(s => now() - s.mtimeMs).catch(() => 0);
      const pid = Number((await readFile(lockFile, 'utf8').catch(() => '')).trim());
      let alive = true;
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); } catch (err) { alive = err?.code !== 'ESRCH'; }
      }
      if (age > 10 * 60_000 && Number.isInteger(pid) && pid > 0 && !alive) {
        logger.warn?.('DM stale lock from exited process detected, retrying ownership');
        // Guard against another process having already replaced the lock.
        const check = Number((await readFile(lockFile, 'utf8').catch(() => '')).trim());
        if (check === pid) {
          await unlink(lockFile).catch(() => {});
          return enterLock();
        }
      }
      logger.warn?.(`DM poll skipped: lock exists (${Math.round(age / 1000)}s old): ${lockFile}`);
      return false;
    }
  };
  const leaveLock = async () => {
    try { await lock?.close(); } finally { lock = null; await unlink(lockFile).catch(() => {}); }
  };

  async function poll() {
    if (polling) return { skipped: 'busy' };
    const opt = resolveOptions(getConfig());
    if (!opt.enabled) return { skipped: 'disabled' };
    polling = true;
    try {
      await mkdir(dataDir, { recursive: true });
      if (!await enterLock()) return { skipped: 'locked' };
      try {
        const db = await load();
        const me = cleanUid(typeof selfUid === 'function' ? await selfUid() : selfUid);
        if (!me) throw new Error('未能确认 B站登录账号 UID，停止回复以避免回复自己');
        const raw = await fetchIncoming();
        if (!Array.isArray(raw)) throw new TypeError('fetchIncoming must return an array');
        // Only messages already retrieved by an authenticated inbox adapter are processed.
        const rows = raw.map(x => validIncoming(x, me)).filter(Boolean)
          .sort((a,b) => a.time - b.time || a.id.localeCompare(b.id));
        lastPollAt = now();
        if (!db.initialized) {
          // Baseline existing inbox without replying. Avoid accidental mass replies on first startup.
          for (const msg of rows) markSeen(personOf(db, msg.uid), msg);
          db.initialized = true;
          await persist(db);
          lastError = '';
          return { initialized: true, baselined: rows.length, sent: 0 };
        }
        // Keep a 24h sliding window for the legacy daily cap, and a 1h subset for rate limiting.
        db.sentAt = db.sentAt.filter(t => Number.isFinite(t) && t > now() - 86400_000);
        const unprocessed = new Map();
        for (const msg of rows) {
          const person = personOf(db, msg.uid);
          if (!person.seen.includes(msg.id)) {
            if (!unprocessed.has(msg.uid)) unprocessed.set(msg.uid, []);
            unprocessed.get(msg.uid).push(msg);
          }
        }
        let sent = 0, failed = 0, ignored = 0, deferred = 0;
        for (const [uid, messages] of unprocessed) {
          const person = personOf(db, uid);
          const allowed = opt.whitelist.has(uid);
          if (!allowed && !opt.strangerEnabled) {
            for (const msg of messages) markSeen(person, msg);
            ignored += messages.length;
            await persist(db);
            continue;
          }
          if (!allowed && person.stranger) {
            for (const msg of messages) markSeen(person, msg);
            ignored += messages.length;
            await persist(db);
            continue;
          }
          // Limit global sends; do not consume message IDs while deferred.
          if (sent >= opt.maxPerPoll || db.sentAt.filter(t => t > now() - 3600_000).length >= opt.maxPerHour
            || (opt.maxPerDay > 0 && db.sentAt.length >= opt.maxPerDay)) { deferred += messages.length; continue; }
          if (allowed && now() - person.lastRepliedAt < opt.whitelistCooldownMs) { deferred += messages.length; continue; }
          const latest = messages[messages.length - 1];
          const history = person.history.slice(-opt.historyLimit);
          let reply;
          if (allowed) {
            if (typeof generateReply !== 'function') { failed++; logger.warn?.('DM whitelist AI adapter is not configured'); continue; }
            try { reply = cleanString(await generateReply({ uid, text: latest.text, messages: messages.map(m => m.text), history }), 900).trim(); }
            catch (e) { failed++; logger.warn?.(`DM AI generation failed for uid=${uid}: ${String(e?.message || e)}`); continue; }
            if (!reply) { failed++; continue; }
          } else reply = opt.strangerText;
          if (!reply) { failed++; continue; }
          // Mark each inbound message before sending. A crash after remote success
          // must never trigger a duplicate automated message on process restart.
          if (!allowed) person.stranger = { status: 'pending', reservedAt: now(), sourceMessageId: latest.id };
          for (const msg of messages) markSeen(person, msg);
          await persist(db);
          try {
            const result = await send({ uid, text: reply });
            if (result !== true && result?.ok !== true) throw new Error(result?.error || 'send did not confirm success');
            if (!allowed) person.stranger.status = 'sent';
            else {
              person.history.push(...messages.map(m => ({ role: 'user', text: m.text })), { role: 'assistant', text: reply });
              person.history = person.history.slice(-opt.historyLimit);
            }
            person.lastRepliedAt = now();
            db.sentAt.push(now());
            await persist(db);
            sent++;
          } catch (e) {
            // If the server accepted a DM but the response was lost, retrying would duplicate it.
            if (!allowed) person.stranger.status = 'uncertain';
            await persist(db);
            failed++;
            logger.warn?.(`DM send uncertain/failed for uid=${uid}: ${String(e?.message || e)}`);
          }
        }
        lastError = '';
        return { sent, failed, ignored, deferred, conversations: unprocessed.size };
      } finally { await leaveLock(); }
    } catch (e) {
      lastError = String(e?.message || e);
      logger.error?.(`DM poll failed: ${lastError}`);
      return { error: lastError };
    } finally { polling = false; }
  }

  const schedule = async () => {
    if (stopped) return;
    try { await poll(); }
    catch (e) { lastError = String(e?.message || e); logger.error?.(`DM scheduler error: ${lastError}`); }
    finally {
      if (!stopped) {
        let delay = 60_000;
        try { delay = resolveOptions(getConfig()).intervalMs; } catch (e) {
          lastError = String(e?.message || e);
        }
        timer = setTimeout(() => { void schedule(); }, delay);
        timer.unref?.(); // 后台轮询不能阻止 DSH 宿主正常退出
      }
    }
  };
  function start() {
    if (!stopped) return;
    stopped = false;
    // Start immediately to establish baseline, then poll per config.
    void schedule();
  }
  function stop() { stopped = true; if (timer) clearTimeout(timer); timer = undefined; }
  const status = () => ({ enabled: resolveOptions(getConfig()).enabled, running: !stopped, polling, lastPollAt, lastError });
  return { poll, start, stop, status, stateFile: file };
}
