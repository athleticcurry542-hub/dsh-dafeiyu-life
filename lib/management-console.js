'use strict';
// No eval/innerHTML for user-supplied strings. Same-origin local console only.
(() => {
  const API='/api/bili-duty';
  const $=id=>document.getElementById(id);
  const node=(tag,text='',className='')=>{const e=document.createElement(tag);if(className)e.className=className;e.textContent=String(text??'');return e};
  const pill=(status)=>node('span',({pending:'待审核',approved:'已批准',rejected:'已拒绝'})[status]||status,'pill '+status);
  const add=(e,...items)=>{for(const x of items)if(x)e.appendChild(x);return e};
  const info=(x)=>node('p',x,'muted');
  const btn=(text,fn,kind='')=>{const b=node('button',text,kind);b.type='button';b.addEventListener('click',()=>run(fn));return b};
  const run=async(fn)=>{const before=$('message').textContent;try{await fn();if($('message').textContent===before)message('操作已完成')}catch(e){message(e?.message||'操作失败',true)}};
  const message=(m,bad=false)=>{const e=$('message');e.textContent=String(m||'');e.style.color=bad?'var(--bad)':'var(--action)'};
  const request=async(path,body)=>{
    const res=await fetch(API+path,body===undefined?{credentials:'same-origin'}:{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let data;try{data=await res.json()}catch{throw Error('服务器未返回 JSON（HTTP '+res.status+'）')}
    if(!res.ok||data?.ok===false)throw Error(String(data?.error||'请求失败').slice(0,180));
    return data;
  };
  const badge=(id,n)=>{const e=$(id);e.hidden=!n;e.textContent=String(n)};
  let active='diagnostics';
  const refresh=()=>loaders[active]();
  const tabNames=['diagnostics','reports','quotas','persona','dm','comments','growth','meme','stickers'];
  const switchTab=tab=>{
    if(!tabNames.includes(tab))return;
    active=tab; for(const t of tabNames){$('panel-'+t).hidden=t!==tab;document.querySelector(`[data-tab="${t}"]`).setAttribute('aria-selected',String(t===tab))}
    message('');run(refresh);
  };
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  $('refresh').addEventListener('click',()=>run(refresh));

  // v2.4.41: 所有数字输入都只在「次数与额度」提交。
  // 将旧评论/私信页的 DOM 控件物理搬迁，保留字段 ID 与原有验证规则，避免双入口覆盖设置。
  const quotaFields=[
    ['quota-per-day','perDay',0,1000000,50],['quota-pick-round','pickPerRound',1,50,5],
    ['quota-comment-daily','commentDailyLimit',0,1000,10],['quota-comment-round','commentPerRound',0,20,5],
    ['quota-dynamic-daily','dynamicDailyLimit',0,30,3],
    ['comment-top-count','commentTopCount',1,20,5],['comment-top-videos','commentTopVideoCount',1,6,3],
    ['comment-per-poll','commentReplyPerPoll',1,5,1],['comment-per-day','commentReplyPerDay',1,1000,5],
    ['comment-own-top-per-user','commentOwnTopPerUser',1,1000,5],['comment-own-nested-per-user','commentOwnNestedPerUser',1,1000,3],
    ['dm-interval','dmWatchMinutes',1,120,1],['dm-reply-per-day','dmReplyPerDay',0,1000,0],
    ['dm-context-messages','dmContextMessages',0,80,40],['dm-stranger-max','dmStrangerMaxReplies',1,20,1],
    ['dm-total','dmApprovedTotalLimit',1,10000,50],['dm-daily','dmApprovedDailyLimit',1,1000,10],
    ['dm-wish-limit','dmWishMentionLimit',1,10,3],
    ['quota-meme-day','commentMemesPerDay',0,10000,2],['quota-meme-round','commentMemesPerRound',0,5,1],
    ['quota-meme-max','memeMemoryMaxEntries',10,2000,300],['quota-vision-frames','visionFrames',1,3,2],
    ['quota-min-views','minVideoViews',0,100000000,1000],['quota-min-likes','minVideoLikes',0,100000000,10],
    ['quota-min-replies','minVideoReplies',0,100000000,3]
  ];
  for (const [target,ids] of [
    ['quota-fields-comment',['comment-top-count','comment-top-videos','comment-per-poll','comment-per-day','comment-own-top-per-user','comment-own-nested-per-user']],
    ['quota-fields-dm',['dm-interval','dm-reply-per-day','dm-context-messages','dm-stranger-max','dm-total','dm-daily','dm-wish-limit']]
  ]) {
    for(const id of ids){const el=$(id);if(el?.parentElement)$(target).appendChild(el.parentElement)}
  }
  const loadQuotas=async()=>{
    const [config,quota]=await Promise.all([request('/config'),request('/comment-quota').catch(()=>({error:'读取全局用量失败'}))]);
    const c=config.config||{};
    for(const [id,key,,,fallback] of quotaFields)$(id).value=String(c[key]??fallback);
    $('quota-usage-summary').textContent=quota.error ? '今日评论用量读取失败，仍可修改保存设置；请到「最近评论」查看错误。' : `${quota.day||localDay()} · 全局公开评论已占用 ${quota.used??0} / ${quota.limit??c.commentDailyLimit??0} 次，剩余 ${Math.max(0,Number(quota.limit??c.commentDailyLimit??0)-Number(quota.used??0))} 次。后台回复的滚动24小时额度在「最近评论」另行统计。`;
  };
  $('quota-refresh').addEventListener('click',()=>run(loadQuotas));
  $('quota-save').addEventListener('click',()=>run(async()=>{
    const payload={};
    for(const [id,key,min,max] of quotaFields)payload[key]=boundedInt(id,min,max,key);
    const saved=await request('/config',payload);
    await loadQuotas();
    message(saved.host?.ok===false?'已写插件配置，但同步到 DSH 失败：'+(saved.host.error||'未知原因'):'全部次数与额度已保存');
  }));

  // 显式加载内置默认提示词，旧用户已有非空自定义优先。不存在自动覆盖和自动保存。
  const promptEntries=[
    ['persona','personaPrompt','/persona-prompt-default','8000','大肥鱼人设'],
    ['meme-prompt','commentMemePrompt','/comment-meme-prompt-default','4000','AI 选图提示词'],
    ['vision-prompt','visionPrompt','/vision-prompt-default','4000','视觉识图提示词'],
    ['lore','characterLore','/character-lore-default','4000','角色背景']
  ];
  const promptDefaults={};
  let friendProfilesDraft={};
  const loadPersona=async()=>{
    const [config,...defaults]=await Promise.all([request('/config'),...promptEntries.map(x=>request(x[2]))]);
    const c=config.config||{};
    for(let i=0;i<promptEntries.length;i++){
      const [id,key]=promptEntries[i];const d=promptDefaults[key]=String(defaults[i].prompt||'');
      $(id+'-text').value=String(c[key]||d);
      $(id+'-status').textContent=String(c[key]||'').trim()?'已自定义':'内置默认';
    }
    $('friends-targets').value=String(c.mentionTargets||'');
    $('friends-mode').value=['ai','ai_select','off','always'].includes(c.mentionMode)?c.mentionMode:'ai';
    try{friendProfilesDraft=JSON.parse(c.mentionProfiles||'{}');if(!friendProfilesDraft||Array.isArray(friendProfilesDraft)||typeof friendProfilesDraft!=='object')friendProfilesDraft={};}
    catch{friendProfilesDraft={}}
    drawFriends();
  };
  const drawFriends=()=>{
    const names=String($('friends-targets').value||'').split(/[\r\n,，;；]+/)
      .map(x=>x.split('|')[0].trim().replace(/^@/,''))
      .filter((x,i,arr)=>x&&x.length<=40&&arr.indexOf(x)===i).slice(0,8);
    const target=$('friends-editor');target.replaceChildren();
    if(!names.length){target.appendChild(info('先填写好友名单，再点击「根据名单编辑画像」。旧好友画像不会因名单暂时为空而被自动清除。'));return}
    for(const name of names){
      const card=node('div','','settings-section');add(card,node('h4',name));
      const fields=node('div','','fields');
      for(const [key,label,max] of [['relationship','与大肥鱼的关系',100],['interests','喜欢的话题',400],['preferences','适合邀请的情境',240]]){
        const wrap=node('div');const fieldLabel=node('label',label);const input=node('input');
        input.maxLength=max;input.value=String(friendProfilesDraft[name]?.[key]||'');
        input.addEventListener('input',()=>{friendProfilesDraft[name]={...(friendProfilesDraft[name]||{}),[key]:input.value}});
        add(wrap,fieldLabel,input);fields.appendChild(wrap);
      }
      card.appendChild(fields);target.appendChild(card);
    }
  };
  $('friends-generate').addEventListener('click',()=>run(async()=>{drawFriends();message('已根据名单生成画像编辑项。填写后别忘记保存。')}));
  $('friends-save').addEventListener('click',()=>run(async()=>{
    const targets=$('friends-targets').value.trim();
    const saved=await request('/config',{mentionTargets:targets,mentionProfiles:JSON.stringify(friendProfilesDraft),mentionMode:$('friends-mode').value,clear:targets?[]:['mentionTargets']});
    await loadPersona();message(saved.host?.ok===false?'画像保存成功，但 DSH 设置同步失败：'+(saved.host.error||'未知原因'):'@ 名单和好友画像已保存');
  }));
  for(const [id,key,,,label] of promptEntries){
    $(id+'-save').addEventListener('click',()=>run(async()=>{
      const text=$(id+'-text').value.trim();if(!text)throw Error(label+'不能为空；需要默认规则，请点击「恢复默认」');
      const isDefault=text===promptDefaults[key];
      const saved=await request('/config',{[key]:isDefault?'':text,clear:isDefault?[key]:[]});
      $(id+'-status').textContent=isDefault?'内置默认':'已自定义';
      message(saved.host?.ok===false?'保存成功，但 DSH 同步失败：'+(saved.host.error||'未知原因'):label+'已保存');
    }));
    $(id+'-reset').addEventListener('click',()=>run(async()=>{
      if(!confirm('恢复「'+label+'」为官方默认？当前自定义内容将清除。'))return;
      const saved=await request('/config',{[key]:'',clear:[key]});
      $(id+'-text').value=promptDefaults[key]||'';
      $(id+'-status').textContent='内置默认';
      message(saved.host?.ok===false?'已清除自定义，但 DSH 同步失败：'+(saved.host.error||'未知原因'):label+'已恢复默认');
    }));
  }
  $('persona-refresh').addEventListener('click',()=>run(loadPersona));

  const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const safeVideoLink=(bvid)=>{const bv=/^BV[0-9A-Za-z]{10}$/.test(String(bvid||''))?String(bvid):'';const a=node('a',bv||'打开视频');a.href='https://www.bilibili.com/video/'+encodeURIComponent(bv);a.target='_blank';a.rel='noopener noreferrer';return a};
  const safeCommentLink=(c)=>{
    const bv=/^BV[0-9A-Za-z]{10}$/.test(String(c?.bvid||''))?String(c.bvid):'';
    const rid=/^\d{6,30}$/.test(String(c?.rpid||''))?String(c.rpid):'';
    const root=/^\d{6,30}$/.test(String(c?.root||''))?String(c.root):'';
    const isReply=c?.kind==='reply';
    const a=node('a',!rid?'打开视频（无评论 ID）':(isReply&&!root?'打开视频（缺少根评论 ID，无法精准定位）':'定位具体评论 · rpid '+rid));
    const base=bv?'https://www.bilibili.com/video/'+encodeURIComponent(bv)+'/':'https://www.bilibili.com/';
    if(bv&&rid&&(!isReply||root)){
      const params=new URLSearchParams();
      params.set('comment_on','1');
      params.set('comment_root_id',isReply?root:rid);
      if(isReply)params.set('comment_secondary_id',rid);
      a.href=base+'?'+params.toString()+'#reply'+encodeURIComponent(rid);
    }else a.href=base;
    a.target='_blank';a.rel='noopener noreferrer';
    if(isReply&&!root&&rid)a.title='该历史记录没有保存根评论 rpid，暂时无法生成精确的楼中楼定位链接。';
    return a
  };
  const reasonLabel=(x)=>({ai_declined:'AI 决定不 @',ai_selected_no_names:'AI 想 @，但未选中名单内好友',no_mention_targets:'没有配置 @ 名单',mention_disabled:'@ 策略已关闭',mentioned_text_only_missing_uid:'缺少有效 UID',mention_requested:'已按设置尝试 @',reply_no_group_mentions:'后台回复不群发 @'}[x]||x||'未提供原因');
  const dynamicStatusLabel=(x)=>({api_accepted_unverified:'B站接口接受（公开状态未核实）',ai_skipped:'AI 选择不同步',disabled:'同步开关关闭',blocked_by_setting:'被用户设置阻止',receipt_unverified:'评论回执不完整，无法安全同步',daily_limit:'达到每日动态上限',already_attempted:'同 BV 今日已尝试',reservation_failed_no_publish:'额度锁失败，未发布',comment_receipt_unverified_no_publish:'评论回执不完整，未发布',uncertain_no_retry:'发送结果不确定，不重试',failed:'动态接口失败',paused:'插件已暂停',not_requested:'未选择同步',comment_failed:'评论失败',not_applicable:'不适用于楼中楼回复'}[x]||x||'状态未知');
  const loadDiagnostics=async()=>{
    const [m,im,vi]=await Promise.all([request('/mention-diagnostics'),request('/meme-diagnostics'),request('/vision-diagnostics')]);
    $('mention-summary').textContent=`${m.day||localDay()} · 已发表评论 ${m.total||0} 条 · 尝试 @ ${m.attempted||0} 条 · 未 @ ${m.notMentioned||0} 条 · 失败 ${m.failed||0} 条`;
    $('mention-list').replaceChildren();
    for(const x of (m.recent||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');add(top,safeVideoLink(x.bvid),node('span',' · '+(x.kind==='reply'?'楼中楼':'顶层')+' · '+(x.success?(x.mention_attempted?'尝试 @':'未 @'):'发送失败')));
      add(card,top,info((x.time||'')+' · '+reasonLabel(x.reason)+(x.mention_delivery?' · '+x.mention_delivery:'')));
      if(x.success&&x.reason==='ai_declined'&&x.ai_reason)add(card,info('AI说明：'+x.ai_reason));
      $('mention-list').appendChild(card);
    }
    if(!$('mention-list').children.length)$('mention-list').append(info('今天还没有 @ 诊断记录。'));
    const dy=m.dynamic||{};
    $('dynamic-summary').textContent=`顶层评论决策 ${dy.evaluated??0} 条 · AI 选择同步 ${dy.aiSelected??0} 条 · 接口接受 ${dy.accepted??0} 条 · AI 选择不同步 ${dy.aiSkipped??0} 条 · 设置／额度阻止 ${dy.blocked??0} 条`;
    $('dynamic-list').replaceChildren();
    for(const x of (m.dynamicRecent||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');
      add(top,safeVideoLink(x.bvid),node('span',' · '+(x.dynamic_ai_decision===true?'AI 选择同步':'AI 选择不同步')+' · '+dynamicStatusLabel(x.dynamic_status)));
      add(card,top,info((x.time||'')+(x.dynamic_reason?' · AI说明：'+x.dynamic_reason:'')));
      $('dynamic-list').appendChild(card);
    }
    if(!$('dynamic-list').children.length)$('dynamic-list').append(info('今天还没有动态决策诊断记录。'));
    $('vision-summary').textContent=`${vi.enabled?'识图开启':'识图关闭'} · Debug ${vi.debug?'开启':'关闭'} · 今日自动识图调用记录 ${vi.attempts||0} 次 · 本地已保存 ${vi.savedBvs||0} 个 BV / ${vi.savedJpegs||0} 张 JPEG · 路径：${vi.pathHint||'vision-debug/BV号/'}。没有记录时请先确认有自动刷片轮次，或到设置页手动测试一个 BV。`;
    $('vision-list').replaceChildren();
    for(const x of (vi.events||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');
      add(top,safeVideoLink(x.bvid),node('span',' · '+x.source+' · '+x.status+(x.debug_saved?' · 已保存JPEG':'')));
      add(card,top,info((x.time||'')+(x.times?.length?' · 预览秒数：'+x.times.join('、'):'')+(x.error?' · '+x.error:'')));
      $('vision-list').appendChild(card);
    }
    if(!$('vision-list').children.length)$('vision-list').append(info('今天没有实际识图工具调用／取帧日志。仅开启 Debug 不会产生文件。'));
    $('meme-summary').textContent=`${im.day||localDay()} · 顶层评论 ${im.total||0} 条 · 选图 ${im.attempted||0} 次 · 尝试附图 ${im.submitted||0} 次 · 未附图 ${im.notAttached||0} 条 · 失败 ${im.failed||0} 条`;
    $('meme-diag-list').replaceChildren();
    for(const x of (im.recent||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');add(top,safeVideoLink(x.bvid),node('span',' · '+(x.success?'评论已成功':'评论未成功')+' · '+(x.selected?'选图':'未选图')+' · '+(x.status||'')));
      add(card,top,info((x.time||'')+(x.image?' · 图片：'+x.image:'')));
      if(x.reason)add(card,info('原因：'+x.reason));
      $('meme-diag-list').appendChild(card);
    }
    if(!$('meme-diag-list').children.length)$('meme-diag-list').append(info('今天还没有表情包诊断记录。'));
  };
  $('diag-refresh').addEventListener('click',()=>run(loadDiagnostics));

  if($('report-day'))$('report-day').value=localDay();
  const loadReport=async()=>{
    const day=$('report-day').value||localDay();
    const data=await request('/report?day='+encodeURIComponent(day));
    $('report-meta').textContent=data.exists?`${data.day} · 已读取本地日报 · ${data.text.length.toLocaleString()} 字符`:`${data.day} · 这一天没有日报文件`;
    $('report-content').textContent=data.exists?(data.text||'（日报文件为空）'):'这一天没有日报。';
  };
  $('report-load').addEventListener('click',()=>run(loadReport));
  $('report-day').addEventListener('change',()=>run(loadReport));
  $('report-copy').addEventListener('click',()=>run(async()=>{const text=$('report-content').textContent||'';await navigator.clipboard.writeText(text);message('已复制报告文本')}));

  // 展示排序与磁盘存储顺序分离：待审核优先，已拒绝放最后，同状态最近修改在前。
  // 不修改 persona-growth/v1.json 的条目顺序或审计记录。
  const growthPriority={pending:0,approved:1,rejected:2};
  const growthDisplayOrder=entries=>[...entries].sort((a,b)=>{
    const priorityA=growthPriority[a.status]??3;
    const priorityB=growthPriority[b.status]??3;
    if(priorityA!==priorityB)return priorityA-priorityB;
    const changedA=Date.parse(a.updatedAt||a.createdAt||'')||0;
    const changedB=Date.parse(b.updatedAt||b.createdAt||'')||0;
    return changedB-changedA;
  });
  let growthPreviewQuery='';
  const growthList=async()=>{
    const data=await request('/persona-growth'+(growthPreviewQuery?'?query='+encodeURIComponent(growthPreviewQuery):''));$('growth-list').replaceChildren();
    const entries=data.data?.entries||[];
    badge('growth-count',entries.filter(e=>e.status==='pending').length);
    const filter=$('growth-filter').value;
    for(const e of growthDisplayOrder(entries.filter(e=>!filter||e.status===filter))){
      const card=node('article','','card');
      add(card,pill(e.status),pill(e.type),info('原始反馈（仅存档）：'+e.text),info('来源：'+(e.source==='owner-direct'?'主人直接编写':e.source==='owner'?'主人反馈':'日报')+(e.evidence?' · '+e.evidence:'')));
      const candidate=e.status==='approved'?(e.approvedText||e.text):(e.suggestedText||(e.source==='report'?e.text:''));
      const title=node('h4',e.status==='approved'?'已批准 · '+({style:'评论风格',interest:'长期兴趣',experience:'视频经历',relationship:'角色关系'}[e.type]||e.type):e.source==='report'?'日报统计候选 · 主人直接审核':(e.source==='owner-direct'||e.directReview)?'主人直接编写 · 待审核':'模型建议 · 审核前可修改');
      add(card,title);
      if(e.status==='approved'){
        add(card,info(candidate));
      }else{
        const edit=node('textarea',candidate);
        edit.value=candidate;edit.maxLength=230;edit.rows=4;edit.readOnly=e.source==='report';edit.placeholder=e.source==='report'?'日报已提供主题观察；直接批准即可':(e.source==='owner-direct'||e.directReview)?'直接审核稿：可修改后保存，再批准':'先点击「AI 提炼建议」，也可以选择直接审核原始反馈';
        edit.style.width='100%';
        add(card,edit);
        if(e.suggestionReason)add(card,info('提炼说明：'+e.suggestionReason));
        const draftActions=node('div','','actions');
        if(e.source==='owner'&&!e.suggestedText&&!e.modelSuggestedAt)add(draftActions,btn('不调用 AI，直接审核原始反馈',async()=>{await request('/persona-growth',{action:'direct',id:e.id});await growthList();message('已将原始反馈转为直接审核稿，可修改后批准。');}));
        if(e.source==='owner')add(draftActions,btn(e.suggestedText?'重新让 AI 提炼':'AI 提炼建议',async()=>{
          message('正在调用 DSH 模型提炼成长建议…');
          const output=await request('/persona-growth',{action:'suggest',id:e.id});
          await growthList();message('模型建议已生成。请先阅读／修改，再决定是否批准。');
        }));
        if(e.source!=='report' && (e.modelSuggestedAt||e.source==='owner-direct'||e.directReview))add(draftActions,btn('保存修改',async()=>{
          if(edit.value.trim().length<((e.source==='owner-direct'||e.directReview)?6:12))throw Error((e.source==='owner-direct'||e.directReview)?'请填写至少 6 字的成长经验':'请填写至少 12 字的建议');
          await request('/persona-growth',{action:'revise',id:e.id,suggestion:edit.value.trim()});
          await growthList();
        }));
        if(e.suggestedText||e.source==='report')add(draftActions,btn(e.source==='report'?'批准该兴趣':(e.source==='owner-direct'||e.directReview)?'批准这条经验':'批准这条建议',async()=>{
          if(e.source!=='report' && edit.value.trim()!==e.suggestedText)throw Error('你修改了审核稿，请先点击「保存修改」，再批准');
          await request('/persona-growth',{action:'approve',id:e.id});await growthList();
        }));
        add(card,draftActions);
      }
      if(e.type==='relationship'){
        const field=node('div','','inset');
        const name=node('input');name.placeholder='人物名称，例如 Claude';name.value=e.personName||'';name.maxLength=48;
        const aliases=node('input');aliases.placeholder='人物别名，用逗号分隔，例如 克劳德, Claude小姐';aliases.value=(e.personAliases||[]).join(', ');aliases.maxLength=600;
        add(field,info('人物名称和别名（仅影响本地检索，不修改已批准正文）'),name,aliases,btn('保存人物索引',async()=>{
          await request('/persona-growth',{action:'person',id:e.id,personName:name.value,personAliases:aliases.value.split(/[,，\n]/).map(x=>x.trim()).filter(Boolean)});
          await growthList();message('人物名称和别名已保存；主题预览和 AI 记忆召回立即生效。');
        }));add(card,field);
      }
      const actions=node('div','','actions');
      if(e.status!=='rejected'&&e.status!=='approved')add(actions,btn('忽略',async()=>{await request('/persona-growth',{action:'reject',id:e.id});await growthList()}));
      add(actions,btn('删除',async()=>{if(e.status==='approved'&&!confirm('这条成长经验已批准并生效，确定删除？'))return;await request('/persona-growth',{action:'delete',id:e.id});await growthList()},'danger'));
      add(card,actions);$('growth-list').appendChild(card);
    }
    if(!entries.length)$('growth-list').append(info('还没有成长经验。'));
    $('growth-context').textContent=(growthPreviewQuery?'【当前主题：'+growthPreviewQuery+'】\n':'【未输入主题：只显示通用经验】\n')+'【视频值班与选片】\n'+(data.contexts?.duty||'（暂无）')+'\n【公开评论互动】\n'+(data.contexts?.comment||'（暂无）')+'\n【私信聊天】\n'+(data.contexts?.dm||'（暂无）')+'\n【相关视频／人物关系】\n'+(data.contexts?.video||'（未输入主题或没有匹配的已批准经历／关系）')+'\n角色关系和视频经历只在主题相关时召回，不会每轮全部注入。';
  };
  $('growth-preview-apply').addEventListener('click',()=>run(async()=>{growthPreviewQuery=$('growth-preview-query').value.trim().slice(0,120);await growthList()}));
  $('growth-preview-reset').addEventListener('click',()=>run(async()=>{growthPreviewQuery='';$('growth-preview-query').value='';await growthList()}));
  $('growth-preview-query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('growth-preview-apply').click()}});
  $('growth-add').addEventListener('click',()=>run(async()=>{
    const text=$('growth-draft').value.trim();if(text.length<6)throw Error('请输入至少 6 字的反馈');
    const button=$('growth-add');button.disabled=true;
    try {
      const added=await request('/persona-growth',{action:'add',type:$('growth-type').value,text});
      const entry=added.result;
      if(entry.status==='approved'){
        await growthList();message('相同原始反馈已经批准，未重复提交。');return;
      }
      $('growth-draft').value='';
      message('反馈已存档，正在调用 DSH 模型提炼…');
      try {
        await request('/persona-growth',{action:'suggest',id:entry.id});
        await growthList();message('AI 建议已经生成。请审核候选内容，确认后再点击批准。');
      } catch(error) {
        await growthList();
        message('反馈已保存为待审核，但模型提炼失败：'+String(error?.message||error)+'。可以在列表中点击「AI 提炼建议」重试。',true);
      }
    } finally {button.disabled=false}
  }));
  $('growth-add-direct').addEventListener('click',()=>run(async()=>{
    const text=$('growth-draft').value.trim();if(text.length<6)throw Error('请输入至少 6 字的成长经验');
    const button=$('growth-add-direct');button.disabled=true;
    try {
      const added=await request('/persona-growth',{action:'add-direct',type:$('growth-type').value,text});
      if(added.result.status==='approved'){await growthList();message('相同内容已经批准，未重复提交。');return;}
      $('growth-draft').value='';await growthList();message('已直接提交待审核，没有调用 AI。检查内容后即可批准。');
    } finally {button.disabled=false}
  }));
  $('growth-sync').addEventListener('click',()=>run(async()=>{
    const result=await request('/persona-growth',{action:'sync'});await growthList();
    message('日报同步：新增 '+(result.result?.added||0)+' 条观察、'+(result.result?.proposals||0)+' 条长期兴趣候选。这类统计兴趣可直接审核，不会修改搜索词。');
  }));
  $('growth-undo').addEventListener('click',()=>run(async()=>{
    if(!confirm('撤销最近一次成长库修改？'))return;await request('/persona-growth',{action:'undo'});await growthList();
  }));
  $('growth-filter').addEventListener('change',()=>run(growthList));

  const memeList=async()=>{
    const q=$('meme-search').value.trim();const data=await request('/meme-memory?q='+encodeURIComponent(q));$('meme-list').replaceChildren();
    const entries=data.entries||[];const counts=data.counts||{};
    badge('meme-count',counts.pending||0);
    $('meme-stats').textContent='共 '+(data.total||0)+' 条 · 待审核 '+(counts.pending||0)+' · 已批准 '+(counts.approved||0)+' · 已拒绝 '+(counts.rejected||0)+'。新梗先审核；旧梗继续可用。最多显示 50 条，支持搜索。';
    for(const e of entries){
      const card=node('article','','card');
      add(card,pill(e.review_status),node('h3',e.name),info(e.meaning),info('别名：'+(e.aliases||'无')+' · '+e.kind+' · '+e.confidence));
      for(const src of (e.sources||[]).slice(0,2))add(card,info(src.bvid+' · '+src.evidence_type+'：'+src.evidence));
      const actions=node('div','','actions');
      add(actions,btn('编辑',()=>editMeme(card,e)));
      if(e.review_status!=='approved')add(actions,btn('批准',async()=>{await request('/meme-memory/review',{id:e.id,status:'approved'});await memeList()}));
      if(e.review_status!=='rejected')add(actions,btn('拒绝',async()=>{await request('/meme-memory/review',{id:e.id,status:'rejected'});await memeList()}));
      add(actions,btn('删除',async()=>{if(!confirm('永久删除梗「'+e.name+'」及其来源？'))return;await request('/meme-memory/delete',{id:e.id});await memeList()},'danger'));
      add(card,actions);$('meme-list').appendChild(card);
    }
    if(!entries.length)$('meme-list').append(info('没有匹配的梗记录。'));
  };
  const editMeme=(card,e)=>{
    if(card.querySelector('.inset'))return;
    const wrap=node('div','','inset');const fields=node('div','','fields');const values={};
    const input=(key,title,value,max)=>{
      const box=node('div');const label=node('label',title);const item=node('input');item.value=value||'';item.maxLength=max;values[key]=item;add(box,label,item);fields.appendChild(box);
    };
    input('name','梗名称',e.name,48);input('aliases','别名',e.aliases,140);
    input('meaning','解释',e.meaning,220);
    const select=(key,title,current,options)=>{const box=node('div');const label=node('label',title);const s=node('select');for(const o of options){const op=node('option',o);op.value=o;s.appendChild(op)}s.value=current;values[key]=s;add(box,label,s);fields.appendChild(box)};
    select('kind','类型',e.kind,['梗','角色','人物','系列','其他']);select('confidence','可信度',e.confidence,['待核实','有文字依据']);
    const actions=node('div','','actions');
    add(actions,btn('保存修改',async()=>{const payload={id:e.id};for(const [k,v]of Object.entries(values))payload[k]=v.value;await request('/meme-memory/edit',payload);await memeList()}),btn('取消',()=>wrap.remove()));
    add(wrap,fields,info('修改释义不会伪造或删除来源；未审核条目仍须点批准才会供 AI 使用。'),actions);card.appendChild(wrap);
  };
  $('meme-new-save').addEventListener('click',()=>run(async()=>{
    const name=$('meme-new-name').value.trim(),meaning=$('meme-new-meaning').value.trim();
    if(name.length<2||!meaning)throw Error('请填写至少两个字的名称和释义');
    await request('/meme-memory/add',{name,meaning,aliases:$('meme-new-aliases').value.trim(),kind:$('meme-new-kind').value,confidence:$('meme-new-confidence').value});
    $('meme-new-name').value='';$('meme-new-aliases').value='';$('meme-new-meaning').value='';
    await memeList();message('已人工新增并启用梗知识');
  }));
  $('meme-find').addEventListener('click',()=>run(memeList));
  $('meme-search').addEventListener('keydown',e=>{if(e.key==='Enter')run(memeList)});

  // 本地文件库管理：与自动评论使用同一个 comment-memes 目录；前端不持有绝对路径。
  let stickerItems=[];
  const renderStickers=()=>{
    const query=$('sticker-search').value.trim().toLowerCase();$('sticker-list').replaceChildren();
    const filtered=stickerItems.filter(s=>s.name.toLowerCase().includes(query));
    for(const s of filtered){
      const card=node('article','','card');
      const img=node('img','','sticker-preview');img.loading='lazy';img.alt=s.name;
      img.src=API+'/stickers/file?name='+encodeURIComponent(s.name);
      const name=node('h3',s.name);const desc=info((s.category||'未分类')+' · '+s.ext.toUpperCase()+' · '+Math.ceil(s.bytes/1024)+' KB');
      const actions=node('div','','actions');
      add(actions,btn('重命名',async()=>{
        const name=prompt('请输入新名称（可使用 分类/图片名）',s.name);
        if(name===null||name===s.name)return;
        await request('/stickers?action=rename',{name:s.name,newName:name.trim()});await loadStickers();message('已重命名表情包');
      }),btn('删除',async()=>{
        if(!confirm('确定永久删除表情包「'+s.name+'」？此操作不可撤销。'))return;
        await request('/stickers?action=delete',{name:s.name});await loadStickers();message('已删除表情包');
      },'danger'));
      add(card,img,name,desc,actions);$('sticker-list').appendChild(card);
    }
    if(!filtered.length)$('sticker-list').append(info('没有匹配的表情包。'));
    $('sticker-summary').textContent='共 '+stickerItems.length+' 张 · 当前显示 '+filtered.length+' 张；底层保留原 comment-memes 文件夹，旧数据不会迁移。';
  };
  const loadStickers=async()=>{const data=await request('/stickers');stickerItems=data.items||[];renderStickers()};
  $('sticker-search').addEventListener('input',renderStickers);
  $('sticker-reload').addEventListener('click',()=>run(loadStickers));
  $('sticker-file').addEventListener('change',()=>{
    const file=$('sticker-file').files?.[0];if(!file)return;
    if(!$('sticker-name').value.trim())$('sticker-name').value=file.name.replace(/\.[^.]+$/,'').slice(0,48);
  });
  $('sticker-upload').addEventListener('click',()=>run(async()=>{
    const file=$('sticker-file').files?.[0];if(!file)throw Error('请先选择图片');
    if(file.size<=0||file.size>8*1024*1024)throw Error('图片需要小于8MB');
    const ext=(file.name.match(/\.(png|jpe?g|gif|webp)$/i)||[])[0]?.toLowerCase();
    if(!ext)throw Error('仅支持 PNG、JPG、GIF、WebP');
    const category=$('sticker-category').value.trim(),stem=$('sticker-name').value.trim();
    const name=(category?category+'/':'')+stem;if(!stem)throw Error('请填写表情包名称');
    const raw=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(file);
    });
    const content=raw.split(',')[1]||'';
    const button=$('sticker-upload');button.disabled=true;$('sticker-upload-status').textContent='正在校验并保存…';
    try{
      await request('/stickers?action=upload',{name,ext,data:content});
      $('sticker-file').value='';$('sticker-name').value='';$('sticker-upload-status').textContent='上传成功';
      await loadStickers();message('已上传表情包：'+name);
    }finally{button.disabled=false}
  }));

  const loadDmSettings=async()=>{
    const data=await request('/config');const cfg=data.config||{};
    $('dm-watch').checked=cfg.dmWatch===true;
    $('dm-stranger-enabled').checked=cfg.dmStrangerOnce===true;
    $('dm-whitelist').value=cfg.dmWhitelist||'';

    $('dm-first-fixed').checked=cfg.dmStrangerFirstFixed!==false;
    $('dm-welcome').value=cfg.dmStrangerText||'';
    $('dm-approval-enabled').checked=cfg.dmApprovalEnabled===true;
    $('dm-phrase').value=cfg.dmApprovalPhrase||'白饭🍚';

  };
  const boundedInt=(id,min,max,label)=>{const n=Number($(id).value);if(!Number.isInteger(n)||n<min||n>max)throw Error(label+'必须是 '+min+'–'+max+' 的整数');return n};
  $('dm-settings-save').addEventListener('click',()=>run(async()=>{
    const phrase=$('dm-phrase').value.trim();if(!phrase||phrase.length>60)throw Error('申请暗号不能为空且最多60字');
    const welcome=$('dm-welcome').value;if(welcome.length>450)throw Error('欢迎语最多450字');
    const whitelist=$('dm-whitelist').value.trim();
    const payload={dmWatch:$('dm-watch').checked,dmStrangerOnce:$('dm-stranger-enabled').checked,
      dmWhitelist:whitelist,clear:[...(!whitelist?['dmWhitelist']:[]),...(!welcome.trim()?['dmStrangerText']:[])],
      dmStrangerFirstFixed:$('dm-first-fixed').checked,dmStrangerText:welcome,
      dmApprovalEnabled:$('dm-approval-enabled').checked,dmApprovalPhrase:phrase,
      };
    const saved=await request('/config',payload);await loadDmSettings();await loadDmStatus();await dmList();await loadDmWishes();message(saved.host?.ok===false?'配置已保存，但 DSH 设置同步失败：'+(saved.host.error||'未知原因'):'后台私信规则已保存');
  }));
  $('dm-settings-reload').addEventListener('click',()=>run(loadDmSettings));
  const loadDmStatus=async()=>{
    const data=await request('/status');const x=data.dmAutoReplyStatus||{};
    $('dm-status').textContent=`监听：${x.enabled?'已开启':'关闭'} · 运行：${x.running?'运行中':'已停止'} · 当前轮询：${x.polling?'正在检查':'空闲'} · 上次检查：${x.lastPollAt?new Date(x.lastPollAt).toLocaleString():'暂无'}`;
    $('dm-error').textContent=x.lastError?'最近错误：'+x.lastError:'最近一次私信轮询没有记录错误。';
  };
  const loadDmRecent=async()=>{
    const data=await request('/dm-recent');const list=$('dm-recent-list');list.replaceChildren();
    for(const c of (data.conversations||[])){
      const card=node('article','','record');add(card,node('strong','UID '+c.uid));
      const status=[c.approvalStatus?'申请 '+c.approvalStatus:'',c.strangerStatus?'陌生人状态 '+c.strangerStatus:'',c.lastRepliedAt?'最近回复 '+new Date(c.lastRepliedAt).toLocaleString():''].filter(Boolean).join(' · ');
      if(status)add(card,info(status));
      for(const m of (c.recent||[]).slice(-5)){add(card,info((m.role==='assistant'?'大肥鱼：':'对方：')+m.text));}
      list.appendChild(card);
    }
    if(!list.children.length)list.append(info(data.error||'本地还没有保存过已回复的私信会话。'));
  };
  const loadDmWishes=async()=>{
    const data=await request('/video-wishes');const list=$('dm-wishes-list');list.replaceChildren();
    for(const w of data.wishes||[]){
      const card=node('article','','record');
      add(card,node('strong','UID '+w.uid+' · '+w.topic),
        info(`已尝试 ${w.accepted||0} / ${w.limit} 次 · 预留／待核实 ${w.reserved||0} 次 · 剩余 ${w.remaining||0} 次 · 有效期至 ${new Date(w.expiresAt).toLocaleDateString()}`));
      const cancelBtn=node('button','取消这条心愿');
      cancelBtn.addEventListener('click',()=>run(async()=>{
        await request('/video-wishes',{action:'cancel',uid:w.uid,id:w.id});await loadDmWishes();message('已取消这条临时@心愿');
      }));
      add(card,cancelBtn);list.appendChild(card);
    }
    if(!list.children.length)list.append(info('暂无有效的临时视频心愿。'));
  };
  $('dm-wishes-refresh').addEventListener('click',()=>run(loadDmWishes));
  const loadDmAll=async()=>{await Promise.all([loadDmSettings(),loadDmStatus(),dmList(),loadDmRecent(),loadDmWishes()])};
  $('dm-network-test').addEventListener('click',()=>run(async()=>{
    $('dm-error').textContent='正在只读测试 api.vc.bilibili.com，会话不会被回复…';
    try {
      const result=await request('/dm-network-check',{});
      $('dm-error').textContent=`连接成功：${result.host} · ${result.sessionCount} 个会话 · ${result.elapsedMs} ms · ${result.checkedAt}`;
      await loadDmStatus();
    } catch(e) {
      $('dm-error').textContent='连接测试失败：'+String(e?.message||e);
      throw e;
    }
  }));
  $('dm-refresh').addEventListener('click',()=>run(loadDmAll));
  $('dm-recent-reload').addEventListener('click',()=>run(loadDmRecent));

  const loadCommentSettings=async()=>{
    const data=await request('/config');const c=data.config||{};
    $('comment-watch-replies').checked=c.commentWatchReplies===true;
    $('comment-watch-top').checked=c.commentWatchTop===true;
    $('comment-allow-general-top').checked=c.commentAllowGeneralTop===true;

  };
  let commentsOffset=0,commentsTotal=0;
  const loadRecentComments=async()=>{
    const limit=Number($('comments-limit').value)||50;
    const day=$('comments-day').value||'';
    const query=new URLSearchParams({limit:String(limit),offset:String(commentsOffset)});
    if(day)query.set('day',day);
    const data=await request('/recent-comments?'+query.toString());
    commentsTotal=Number(data.total)||0;
    const list=$('recent-comments-list');list.replaceChildren();
    const counts=data.counts||{};
    $('comments-summary').textContent=(day?day+' · ':'全部日期 · ')+`主判重表共 ${commentsTotal} 条`+
      (counts.withoutId?` · ${counts.withoutId} 条没有评论 ID`:'')+'。含一次性补录的旧成功回执；这里不代表 B站 已公开可见。';
    for(const c of (data.rows||[])){
      const card=node('article','','record');const top=node('div');
      add(top,safeCommentLink(c),node('span',' · '+(c.kind==='reply'?'后台回复':'顶层评论')+' · '+(c.rpid?'rpid '+c.rpid:'未记录 rpid')));
      add(card,top,info((c.time||'时间未记录')+' · '+(c.snippet||'（没有保存正文摘要）')),
        info('来源：'+(c.source||'本地记录')+' · 公开状态未核实'));
      list.appendChild(card);
    }
    if(!list.children.length)list.append(info(day?'这一天没有找到本地评论记录。':data.note||'暂时没有记录。'));
    $('comments-prev').disabled=commentsOffset===0;
    $('comments-next').disabled=commentsOffset+limit>=commentsTotal;
    $('comments-page-info').textContent=commentsTotal?`${commentsOffset+1}–${Math.min(commentsOffset+limit,commentsTotal)} / ${commentsTotal}`:'0 条';
  };
  const loadCommentsStatus=async()=>{
    const data=await request('/status');const c=data.commentInteractStatus||{};
    $('comments-status').textContent=`后台评论互动：${c.busy?'正在运行':'空闲'} · 上次检查：${c.lastPollAt?new Date(c.lastPollAt).toLocaleString():'暂无'}${c.lastError?' · 错误：'+c.lastError:''}`;
    $('comments-usage').textContent=`近24小时后台回复成功回执：${c.sentLast24Hours??0} / ${c.replyPerDay??5} 条。我的主评论下：${c.sentOnOwnTop24h??0}；我的楼中楼回复下：${c.sentOnOwnNested24h??0}。这是后台互动自己的滚动24小时上限，不是全局每日额度。`;
    $('comments-send-stats').textContent=`近24小时后台发送记录：成功回执 ${c.sentLast24Hours??0} · 明确失败 ${c.sendFailedLast24Hours??0} · 结果不确定 ${c.sendUncertainLast24Hours??0} · 全局额度／配额安全拦截 ${c.sendBlockedByGlobalQuotaLast24Hours??0} · 其他拦截 ${c.sendBlockedOtherLast24Hours??0} · 中断后待核实 ${c.sendPendingLast24Hours??0}。`;
    const historyStarted=c.sendAttemptHistoryStartedAt?new Date(c.sendAttemptHistoryStartedAt).toLocaleString():'';
    const quotaPauseNote=c.globalQuotaBlocked
      ? (c.globalQuotaBlockReason==='store-error'?'公开评论额度账本暂不可用：后台暂停5分钟后重试，避免每轮重复撞错误。':'全局额度已耗尽：本轮停止继续生成／发送，避免每次后台轮询重复撞额度；新自然日或修改全局上限后会重新检查。')
      : '发送结果分类已启用。';
    $('comments-history-note').textContent=c.sendAttemptHistoryAvailable
      ? `${quotaPauseNote}${historyStarted?' 发送结果分类从 '+historyStarted+' 开始记录；此前的历史失败数无法追溯。':''} “成功回执”仍不代表 B 站当前公开可见。`
      : '旧版本没有保存完整的发送失败时间线；升级后开始记录新发送的成功、失败、额度拦截和中断待核实状态。旧历史失败数无法追溯。';
  };
  const loadCommentGlobalQuota=async()=>{
    const target=$('global-comment-quota'),note=$('global-comment-quota-note');
    try{
      const q=await request('/comment-quota');
      if(q.ok!==true)throw Error(q.error||'读取失败');
      const used=Math.max(0,Number(q.used)||0),limit=Math.max(0,Number(q.limit)||0),day=String(q.day||localDay());
      if(limit===0)target.textContent=`${day} · 全局公开评论已禁用（上限为 0）· 本地账本仍记录 ${used} 次历史发送尝试。`;
      else target.textContent=`${day} · 今日已占用 ${used} / ${limit} 次 · 剩余 ${Math.max(0,limit-used)} 次。`;
      note.textContent='自然日硬上限：主动发表的公开主评论 + 后台楼中楼／评论回复共用；以即将调用 B 站发布接口的发送尝试计数。失败或结果不确定的真实发布尝试也会占用名额。旧版本当天记录可能包含发送前校验失败的占位，升级后新记录已调整为临近发布接口时才占位。';
    }catch(e){
      target.textContent='今日全局额度暂不可读取：'+String(e?.message||e).slice(0,140);
      note.textContent='无法读取时不要根据后台回复的 55/100 推断全局额度；两套计数相互独立。';
    }
  };
  const loadCommentsAll=async()=>{await Promise.all([loadCommentSettings(),loadRecentComments(),loadCommentsStatus(),loadCommentGlobalQuota()])};
  $('comments-settings-save').addEventListener('click',()=>run(async()=>{
    const payload={commentWatchReplies:$('comment-watch-replies').checked,commentWatchTop:$('comment-watch-top').checked,
      commentAllowGeneralTop:$('comment-allow-general-top').checked,
};
    const saved=await request('/config',payload);await loadCommentsAll();message(saved.host?.ok===false?'评论设置已保存，但 DSH 设置同步失败：'+(saved.host.error||'未知原因'):'后台评论互动设置已保存');
  }));
  $('comments-load').addEventListener('click',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-day').addEventListener('change',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-day-clear').addEventListener('click',()=>run(()=>{$('comments-day').value='';commentsOffset=0;return loadRecentComments()}));
  $('comments-limit').addEventListener('change',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-prev').addEventListener('click',()=>run(()=>{commentsOffset=Math.max(0,commentsOffset-(Number($('comments-limit').value)||50));return loadRecentComments()}));
  $('comments-next').addEventListener('click',()=>run(()=>{commentsOffset+=Number($('comments-limit').value)||50;return loadRecentComments()}));
  $('comments-limit').addEventListener('change',()=>run(loadRecentComments));
  $('comments-refresh').addEventListener('click',()=>run(loadCommentsAll));

  const dmList=async()=>{
    const data=await request('/dm-approvals');const entries=data.approvals||[];$('dm-list').replaceChildren();
    badge('dm-count',entries.filter(x=>x.status==='pending').length);
    const f=$('dm-filter').value;
    for(const e of entries.filter(x=>!f||x.status===f)){
      const card=node('article','','card');add(card,pill(e.status),node('h3','UID '+e.uid),info('申请消息：'+(e.lastText||'（无）')),
        info('已获批累计回复 '+(e.total||0)+' 条 · 今日 '+(e.daily||0)+' 条'));
      const resumeInfo={queued:'已通过：下次后台私信轮询将自动接话，无需对方再发送消息',reserved:'自动回复发送中／等待确认',sent:'已自动回复'+(e.autoReplyAt?' · '+new Date(e.autoReplyAt).toLocaleString():''),
        uncertain:'发送回执不确定：为防重复发送已暂停自动重试，请检查 B站私信',cancelled:'自动回复已取消'};
      if(e.autoReplyStatus) add(card,info(resumeInfo[e.autoReplyStatus]||'自动回复状态：'+e.autoReplyStatus));
      const actions=node('div','','actions');
      if(e.status==='pending')add(actions,btn('批准聊天',async()=>{if(!confirm('确认授权 UID '+e.uid+' 在设置限额内继续聊天？'))return;await request('/dm-approvals',{uid:e.uid,action:'approve'});await dmList()}),
        btn('拒绝',async()=>{await request('/dm-approvals',{uid:e.uid,action:'reject'});await dmList()}));
      if(e.canResume)
        add(actions,btn('补发首次回复（旧版）',async()=>{if(!confirm('仅适用于旧版批准后没有自动回复的申请。请先确认没有在 B站 手动回复过该用户，避免重复私信。继续？'))return;
          await request('/dm-approvals',{uid:e.uid,action:'resume'});await dmList()}));
      if(e.status==='approved')add(actions,btn('撤销授权',async()=>{if(!confirm('撤销 '+e.uid+' 的限额聊天权限？'))return;await request('/dm-approvals',{uid:e.uid,action:'revoke'});await dmList()},'danger'));
      add(card,actions);$('dm-list').appendChild(card);
    }
    if(!$('dm-list').children.length)$('dm-list').append(info('当前没有符合条件的聊天申请。'));
  };
  $('dm-filter').addEventListener('change',()=>run(dmList));
  const loaders={diagnostics:loadDiagnostics,reports:loadReport,quotas:loadQuotas,persona:loadPersona,dm:loadDmAll,comments:loadCommentsAll,growth:growthList,meme:memeList,stickers:loadStickers};
  run(async()=>{await Promise.all([loadDiagnostics(),loadReport(),loadQuotas(),loadPersona(),loadDmAll(),loadCommentsAll(),growthList(),memeList(),loadStickers()]);switchTab('diagnostics')});
})();
