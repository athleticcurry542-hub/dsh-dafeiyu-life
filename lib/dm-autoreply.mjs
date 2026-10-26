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
import { updateVideoWishes, listActiveVideoWishes } from './video-wishes.mjs';

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
    strangerMaxReplies: clamp(config.strangerMaxReplies, 1, 20, 1),
    strangerFirstFixed: config.strangerFirstFixed !== false,
    whitelist,
    strangerText: cleanString(config.strangerText || DEFAULT_STRANGER_TEXT, 450),
    approvalEnabled: config.approvalEnabled === true,
    approvalPhrase: cleanString(config.approvalPhrase || '白饭🍚',60).trim(),
    approvedTotalLimit: clamp(config.approvedTotalLimit, 1, 10000, 50),
    approvedDailyLimit: clamp(config.approvedDailyLimit, 1, 1000, 10),
    wishMentionLimit: clamp(config.wishMentionLimit, 1, 10, 3),
    intervalMs: clamp(config.intervalMinutes, 1, 120, 1) * 60_000,
    maxPerPoll: clamp(config.maxPerPoll, 1, 20, 3),
    maxPerHour: clamp(config.maxPerHour, 1, 120, 60),
    maxPerDay: clamp(config.maxPerDay, 0, 1000, 0),
    whitelistCooldownMs: clamp(config.whitelistCooldownSeconds, 0, 600, 20) * 1000,
    historyLimit: clamp(config.historyLimit, 0, 80, 40),
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
const personOf = (db, uid) => (db.people[uid] ??= {seen:[], history:[], olderContext:[], lastRepliedAt:0, stranger:null});
const todayOf = (ms) => { const d=new Date(ms);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const normalizeApplication = value => String(value||'').replace(/[\s\uFE0F]/g,'').trim();
const applied = (text,phrase) => normalizeApplication(text) === normalizeApplication(phrase) ||
  (normalizeApplication(phrase)==='白饭🍚' && ['白饭','白饭🍙'].includes(normalizeApplication(text)));
/** 只保存最近的旧消息片段，不自动声称它们是准确的长期摘要。 */
function retainHistory(person, limit) {
  if (person.history.length <= limit) return;
  const dropped=person.history.splice(0,person.history.length-limit);
  const notes=Array.isArray(person.olderContext)?person.olderContext:[];
  person.olderContext=notes.concat(dropped.filter(x=>x.role==='user').map(x=>String(x.text).slice(0,110))).slice(-12);
}

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
        // 审核通过时，对方的投喂消息通常已经进入 seen。把审批队列当作一条
        // 待处理的已验证来信，与本轮新消息合并；不依赖对方再次发言或接口重新返回旧消息。
        for (const [uid, person] of Object.entries(db.people)) {
          const reply = person?.approval?.reply;
          if (!cleanUid(uid) || person.approval?.status !== 'approved' || reply?.status !== 'queued') continue;
          const queuedMessage = {
            uid, id: cleanString(reply.sourceMessageId || `approval:${person.approval.requestedAt || 'legacy'}`, 150),
            time: Number(reply.queuedAt) || now(), text: cleanString(reply.text || opt.approvalPhrase || '🍚', 100),
            approvalResume: true,
          };
          unprocessed.set(uid, [queuedMessage, ...(unprocessed.get(uid) || [])]);
        }
        let sent = 0, failed = 0, ignored = 0, deferred = 0;
        for (const [uid, messages] of unprocessed) {
          const person = personOf(db, uid);
          const trusted = opt.whitelist.has(uid);
          const approved = !trusted && person.approval?.status==='approved';
          const allowed = trusted || approved;
          const approvalQueued = person.approval?.status === 'approved' && person.approval.reply?.status === 'queued';
          // 兼容 2.1.x 的 {status: sent} 旧记录：视为已回复过一次。
          const count = Number.isInteger(person.stranger?.count) ? person.stranger.count : (person.stranger ? 1 : 0);
          if (!allowed && (count >= opt.strangerMaxReplies || (person.stranger && person.stranger.status !== 'sent'))) {
            if (opt.approvalEnabled && person.approval?.status !== 'approved' && person.approval?.status !== 'pending'
              && messages.some(m=>applied(m.text,opt.approvalPhrase))) {
              const trigger = messages.findLast(m => applied(m.text, opt.approvalPhrase));
              person.approval = {status:'pending',requestedAt:now(),lastText:cleanString(trigger.text,100),lastMessageId:trigger.id};
            }
            for (const msg of messages) markSeen(person, msg);
            ignored += messages.length;
            await persist(db);
            continue;
          }
          if (!allowed && !opt.strangerEnabled) {
            for (const msg of messages) markSeen(person, msg);
            ignored += messages.length;
            await persist(db);
            continue;
          }
          if (approved) {
            const u = person.approvedUsage ??= {total:0, day:'', daily:0};
            const day=todayOf(now());
            if (u.day!==day){u.day=day;u.daily=0;}
            if (u.total>=opt.approvedTotalLimit || u.daily>=opt.approvedDailyLimit) {
              // 审核后第一条回复必须保留到额度重置/增加后继续发送。
              // 普通已批准用户的历史额度行为保持不变。
              if (approvalQueued) deferred += messages.length;
              else {
                for(const msg of messages) markSeen(person,msg);
                ignored += messages.length;
                await persist(db);
              }
              continue;
            }
          }
          // Limit global sends; do not consume message IDs while deferred.
          // 兼容旧白名单语义：全局自动私信限额只约束普通/获批用户；
          // 信任白名单仍不受此配额影响，但照常遵守发送冷却。
          if (sent >= opt.maxPerPoll || (!trusted && (db.sentAt.filter(t => t > now() - 3600_000).length >= opt.maxPerHour
            || (opt.maxPerDay > 0 && db.sentAt.length >= opt.maxPerDay)))) { deferred += messages.length; continue; }
          if (now() - person.lastRepliedAt < opt.whitelistCooldownMs) { deferred += messages.length; continue; }
          const latest = messages[messages.length - 1];
          const history = opt.historyLimit ? person.history.slice(-opt.historyLimit) : [];
          const olderContext = opt.historyLimit ? (person.olderContext||[]).join('；').slice(-1100) : '';
          let reply;
          if (allowed || !(opt.strangerFirstFixed && count === 0)) {
            if (typeof generateReply !== 'function') { failed++; logger.warn?.('DM whitelist AI adapter is not configured'); continue; }
            try { reply = cleanString(await generateReply({ uid, text: latest.text, messages: messages.map(m => m.text), history, olderContext, stranger: !allowed,
              canSkip:!approvalQueued,
              ...(approvalQueued ? {mode:'approval-resume',context:'对方之前投喂了聊天暗号，现在可以自然接话；幽默感谢投喂，绝不提内部审核或后台流程。'} : {}) }), 900).trim(); }
            catch (e) { failed++; logger.warn?.(`DM AI generation failed for uid=${uid}: ${String(e?.message || e)}`); continue; }
            if (!reply) { failed++; continue; }
          } else reply = opt.strangerText;
          if (!reply) { failed++; continue; }
          // 只有已获批、明确请求找视频时才登记心愿；即便本轮自然静默，也不丢掉有效请求。
          // 只为已获批、明确提出找视频请求的人登记心愿；陌生人闲聊不自动订阅。
          if (approved) {
            for (const msg of messages) if (!msg.approvalResume) {
              const wish = updateVideoWishes(person, msg.text, {
                uid, messageId:msg.id, now:now(), limit:opt.wishMentionLimit,
              });
              if (wish?.created) logger.info?.(`DM 视频心愿已记录：UID=${uid} 主题=${wish.topic} 最多${wish.record.limit}次`);
            }
          }
          if (reply === 'SKIP') {
            if (approvalQueued) {
              // 已承诺的首次接话不允许跳过，保留待回复任务供下一轮处理。
              failed++;
              logger.warn?.(`DM approval-resume cannot be silently skipped for uid=${uid}`);
              continue;
            }
            // 真正静默：仅确认已读并保留同一用户的上下文；不占发送次数、冷却或陌生人配额。
            for (const msg of messages) if (!msg.approvalResume) markSeen(person, msg);
            person.history.push(...messages.filter(m=>!m.approvalResume).map(m=>({role:'user',text:m.text})));
            retainHistory(person,opt.historyLimit || 40);
            await persist(db);
            ignored += messages.length;
            continue;
          }
          // 审核后的首次接话自然地埋一点彩蛋，不说‘找视频功能’，也不解释谁批准了。
          // 若本轮对方又说了新话题则让 AI 自然回复，不强塞第二句。
          if (approvalQueued && !messages.some(m=>!m.approvalResume) && !/刷到|视频|遇见好玩|想到你/.test(reply)) {
            const hint='哪天本鱼刷到点合胃口的，说不定还会想起你喔🐳';
            reply=(reply.slice(0,Math.max(0,440-hint.length)).trim()+'\n'+hint).trim();
          }
          // 陌生人最后一条回复附投喂暗号：不要在面向 B站用户的文案中透露内部审批流程。
          // 暗号仍来自配置；只是改变面向陌生人的措辞，不承诺一定会有后续回复。
          if (!allowed && opt.approvalEnabled && count + 1 === opt.strangerMaxReplies) {
            const invite = `给本鱼投喂一口「${opt.approvalPhrase}」试试嘛～说不定吃饱了，又能冒泡陪你唠两句🐳`;
            reply = (reply.slice(0,Math.max(0,440-invite.length))+'\n'+invite).trim();
          }
          // Mark each inbound message before sending. A crash after remote success
          // must never trigger a duplicate automated message on process restart.
          if (!allowed) person.stranger = { status: 'pending', count: count + 1, reservedAt: now(), sourceMessageId: latest.id };
          // 远端可能已发送成功但回执丢失：发送前持久化占位，避免重启后重复私信。
          if (approvalQueued) { person.approval.reply.status = 'reserved'; person.approval.reply.reservedAt = now(); }
          for (const msg of messages) if (!msg.approvalResume) markSeen(person, msg);
          await persist(db);
          try {
            const result = await send({ uid, text: reply });
            if (result !== true && result?.ok !== true) throw new Error(result?.error || 'send did not confirm success');
            if (!allowed) person.stranger.status = 'sent';
            if (approvalQueued) { person.approval.reply.status = 'sent'; person.approval.reply.sentAt = now(); }
            person.history.push(...messages.map(m => ({ role: 'user', text: m.text })), { role: 'assistant', text: reply });
            retainHistory(person,opt.historyLimit || 40); // 0 表示不注入历史，后台仍保留 40 条；非零沿用旧摘要兼容逻辑。
            if(approved){
              const u=person.approvedUsage;
              u.total++;u.daily++;
            }
            person.lastRepliedAt = now();
            db.sentAt.push(now());
            await persist(db);
            sent++;
          } catch (e) {
            // If the server accepted a DM but the response was lost, retrying would duplicate it.
            if (!allowed) person.stranger.status = 'uncertain';
            if (approvalQueued) person.approval.reply.status = 'uncertain';
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
  async function listApprovals() {
    const db=await load();
    return Object.entries(db.people).filter(([uid,p])=>cleanUid(uid)&&p?.approval)
      .map(([uid,p])=>({uid,status:p.approval.status,requestedAt:p.approval.requestedAt||0,
        approvedAt:p.approval.approvedAt||0,lastText:cleanString(p.approval.lastText||'',100),
        autoReplyStatus:String(p.approval.reply?.status||''),autoReplyAt:Number(p.approval.reply?.sentAt||0),
        canResume:p.approval.status==='approved' && !p.approval.reply && !!p.approval.lastText
          && !(Number(p.approval.approvedAt)>0 && Number(p.lastRepliedAt)>=Number(p.approval.approvedAt)),
        total:Number(p.approvedUsage?.total||0),daily:Number(p.approvedUsage?.daily||0),day:p.approvedUsage?.day||''}))
      .sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));
  }
  async function listRecentConversations(limit=30) {
    const db=await load();
    const max=clamp(limit,1,50,30);
    return Object.entries(db.people||{}).map(([uid,p])=>{
      const history=Array.isArray(p?.history)?p.history:[];
      const recent=history.slice(-6).map(x=>({role:x?.role==='assistant'?'assistant':'user',text:cleanString(x?.text,240)}));
      return {uid:cleanUid(uid),lastRepliedAt:Number(p?.lastRepliedAt||0),
        strangerStatus:String(p?.stranger?.status||''),approvalStatus:String(p?.approval?.status||''),
        seenCount:Array.isArray(p?.seen)?p.seen.length:0,recent};
    }).filter(x=>x.uid && (x.recent.length || x.approvalStatus))
      .sort((a,b)=>b.lastRepliedAt-a.lastRepliedAt).slice(0,max);
  }
  async function listVideoWishes() {
    const db=await load();
    return listActiveVideoWishes(db,dataDir,now());
  }
  async function cancelVideoWish(uid,id) {
    uid=cleanUid(uid);
    if(!uid || !/^[0-9a-f-]{36}$/i.test(String(id))) return {ok:false,error:'UID 或心愿 ID 不合法'};
    await mkdir(dataDir,{recursive:true});
    if(!await enterLock())return {ok:false,error:'后台正在处理，请稍后重试'};
    try {
      const db=await load(),p=db.people[uid];
      const wish=(p?.videoWishes||[]).find(w=>w.id===id && w.status==='active');
      if(!wish)return {ok:false,error:'未找到有效心愿'};
      wish.status='cancelled';await persist(db);
      return {ok:true,uid,id,status:'cancelled'};
    }finally{await leaveLock()}
  }
  async function reviewApproval(uid,action) {
    uid=cleanUid(uid);
    if(!uid || !['approve','reject','revoke','resume'].includes(action)) return {ok:false,error:'UID 或操作不合法'};
    await mkdir(dataDir,{recursive:true});
    if(!await enterLock()) return {ok:false,error:'后台正在处理私信，请稍后再试'};
    try {
      const db=await load();const p=db.people[uid];
      if(!p?.approval) return {ok:false,error:'未找到申请记录'};
      if(action==='approve' && p.approval.status!=='pending') return {ok:false,error:'只能通过待审批申请'};
      if(action==='revoke' && p.approval.status!=='approved') return {ok:false,error:'只能撤销已通过的权限'};
      if(action==='resume') {
        // 已使用旧版本批准的用户没有排队字段，不可擅自批量给他们发私信。
        // 主人明确操作后才能补发，并拒绝重复排队或已有自动回复的申请。
        if(p.approval.status!=='approved' || p.approval.reply) return {ok:false,error:'只支持旧版本尚未生成首次回复的已批准申请'};
        if(Number(p.approval.approvedAt)>0 && Number(p.lastRepliedAt)>=Number(p.approval.approvedAt))
          return {ok:false,error:'批准后已有自动回复记录，不能补发'};
      } else p.approval.status=action==='approve'?'approved':'rejected';
      if(action==='approve') {
        p.approval.approvedAt=now();p.approvedUsage={total:0,day:'',daily:0};
        // 申请暗号早已被 seen 消费，必须在批准时重新建立一条持久化的待回复任务。
        // 兼容旧版没有 lastMessageId 的 pending 申请，不要求对方再发消息。
        p.approval.reply={status:'queued',text:cleanString(p.approval.lastText||resolveOptions(getConfig()).approvalPhrase||'🍚',100),
          sourceMessageId:cleanString(p.approval.lastMessageId||'',150),queuedAt:now()};
      } else if (action==='resume') {
        p.approval.reply={status:'queued',text:cleanString(p.approval.lastText||resolveOptions(getConfig()).approvalPhrase||'🍚',100),
          sourceMessageId:cleanString(p.approval.lastMessageId||'',150),queuedAt:now()};
      } else if (p.approval.reply?.status==='queued') {
        p.approval.reply.status='cancelled';
      }
      if (action==='revoke' || action==='reject') {
        for(const w of p.videoWishes||[])if(w.status==='active')w.status='cancelled';
      }
      await persist(db);
      return {ok:true,uid,status:p.approval.status,autoReplyStatus:p.approval.reply?.status||''};
    }finally{await leaveLock();}
  }
  return { poll, start, stop, status, listApprovals, listRecentConversations, reviewApproval, listVideoWishes, cancelVideoWish, stateFile: file };
}
