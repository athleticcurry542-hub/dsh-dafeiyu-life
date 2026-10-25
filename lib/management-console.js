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
  const run=async(fn)=>{try{await fn();message('操作已完成')}catch(e){message(e?.message||'操作失败',true)}};
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
  const tabNames=['diagnostics','reports','dm','comments','growth','meme'];
  const switchTab=tab=>{
    if(!tabNames.includes(tab))return;
    active=tab; for(const t of tabNames){$('panel-'+t).hidden=t!==tab;document.querySelector(`[data-tab="${t}"]`).setAttribute('aria-selected',String(t===tab))}
    message('');run(refresh);
  };
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  $('refresh').addEventListener('click',()=>run(refresh));

  const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const safeVideoLink=(bvid)=>{const a=node('a',bvid);a.href='https://www.bilibili.com/video/'+encodeURIComponent(String(bvid||''));a.target='_blank';a.rel='noreferrer';return a};
  const reasonLabel=(x)=>({ai_declined:'AI 决定不 @',ai_selected_no_names:'AI 想 @，但未选中名单内好友',no_mention_targets:'没有配置 @ 名单',mention_disabled:'@ 策略已关闭',mentioned_text_only_missing_uid:'缺少有效 UID',mention_requested:'已按设置尝试 @',reply_no_group_mentions:'后台回复不群发 @'}[x]||x||'未提供原因');
  const loadDiagnostics=async()=>{
    const [m,im]=await Promise.all([request('/mention-diagnostics'),request('/meme-diagnostics')]);
    $('mention-summary').textContent=`${m.day||localDay()} · 已发表评论 ${m.total||0} 条 · 尝试 @ ${m.attempted||0} 条 · 未 @ ${m.notMentioned||0} 条 · 失败 ${m.failed||0} 条`;
    $('mention-list').replaceChildren();
    for(const x of (m.recent||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');add(top,safeVideoLink(x.bvid),node('span',' · '+(x.kind==='reply'?'楼中楼':'顶层')+' · '+(x.success?(x.mention_attempted?'尝试 @':'未 @'):'发送失败')));
      add(card,top,info((x.time||'')+' · '+reasonLabel(x.reason)+(x.mention_delivery?' · '+x.mention_delivery:'')));
      if(x.success&&x.reason==='ai_declined'&&x.ai_reason)add(card,info('AI说明：'+x.ai_reason));
      $('mention-list').appendChild(card);
    }
    if(!$('mention-list').children.length)$('mention-list').append(info('今天还没有 @ 诊断记录。'));
    $('meme-summary').textContent=`${im.day||localDay()} · 顶层评论 ${im.total||0} 条 · 选图 ${im.attempted||0} 次 · 尝试附图 ${im.submitted||0} 次 · 未附图 ${im.notAttached||0} 条 · 失败 ${im.failed||0} 条`;
    $('meme-diag-list').replaceChildren();
    for(const x of (im.recent||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');add(top,safeVideoLink(x.bvid),node('span',' · '+(x.success?'评论已成功':'评论未成功')+' · '+(x.selected?'选图':'未选图')+' · '+(x.status||'')));
      add(card,top,info((x.time||'')+(x.image?' · 图片：'+x.image:'')));
      if(x.reason)add(card,info('原因：'+x.reason));
      $('meme-diag-list').appendChild(card);
    }
    if(!$('meme-diag-list').children.length)$('meme-diag-list').append(info('今天还没有梗图诊断记录。'));
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

  const growthList=async()=>{
    const data=await request('/persona-growth');$('growth-list').replaceChildren();
    const entries=data.data?.entries||[];
    badge('growth-count',entries.filter(e=>e.status==='pending').length);
    const filter=$('growth-filter').value;
    for(const e of entries.filter(e=>!filter||e.status===filter)){
      const card=node('article','','card');
      add(card,pill(e.status),pill(e.type),info('原始反馈（仅存档）：'+e.text),info('来源：'+(e.source==='owner'?'主人反馈':'日报')+(e.evidence?' · '+e.evidence:'')));
      const candidate=e.status==='approved'?(e.approvedText||e.text):(e.suggestedText||(e.source==='report'?e.text:''));
      const title=node('h4',e.status==='approved'?'已批准 · '+({style:'评论风格',interest:'长期兴趣',experience:'视频经历',relationship:'角色关系'}[e.type]||e.type):e.source==='report'?'日报统计候选 · 主人直接审核':'模型建议 · 审核前可修改');
      add(card,title);
      if(e.status==='approved'){
        add(card,info(candidate));
      }else{
        const edit=node('textarea',candidate);
        edit.value=candidate;edit.maxLength=230;edit.rows=4;edit.readOnly=e.source==='report';edit.placeholder=e.source==='report'?'日报已提供主题观察；直接批准即可':'先点击「AI 提炼建议」，待模型返回后可在这里调整措辞';
        edit.style.width='100%';
        add(card,edit);
        if(e.suggestionReason)add(card,info('提炼说明：'+e.suggestionReason));
        const draftActions=node('div','','actions');
        if(e.source!=='report')add(draftActions,btn(e.suggestedText?'重新让 AI 提炼':'AI 提炼建议',async()=>{
          message('正在调用 DSH 模型提炼成长建议…');
          const output=await request('/persona-growth',{action:'suggest',id:e.id});
          await growthList();message('模型建议已生成。请先阅读／修改，再决定是否批准。');
        }));
        if(e.source!=='report' && e.modelSuggestedAt)add(draftActions,btn('保存修改',async()=>{
          if(edit.value.trim().length<12)throw Error('请填写至少 12 字的建议');
          await request('/persona-growth',{action:'revise',id:e.id,suggestion:edit.value.trim()});
          await growthList();
        }));
        if(e.suggestedText||e.source==='report')add(draftActions,btn(e.source==='report'?'批准该兴趣':'批准这条建议',async()=>{
          if(e.source!=='report' && edit.value.trim()!==e.suggestedText)throw Error('你修改了建议内容，请先点击「保存修改」，再批准');
          await request('/persona-growth',{action:'approve',id:e.id});await growthList();
        }));
        add(card,draftActions);
      }
      const actions=node('div','','actions');
      if(e.status!=='rejected'&&e.status!=='approved')add(actions,btn('忽略',async()=>{await request('/persona-growth',{action:'reject',id:e.id});await growthList()}));
      add(actions,btn('删除',async()=>{if(!confirm('删除这条成长经验？'))return;await request('/persona-growth',{action:'delete',id:e.id});await growthList()},'danger'));
      add(card,actions);$('growth-list').appendChild(card);
    }
    if(!entries.length)$('growth-list').append(info('还没有成长经验。'));
    $('growth-context').textContent='【视频值班与选片】\n'+(data.contexts?.duty||'（暂无）')+'\n【公开评论互动】\n'+(data.contexts?.comment||'（暂无）')+'\n【私信聊天】\n'+(data.contexts?.dm||'（暂无）')+'\n视频经历／角色关系只在相关视频或话题出现时按需检索，不全量塞入提示词。';
  };
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
  $('meme-find').addEventListener('click',()=>run(memeList));
  $('meme-search').addEventListener('keydown',e=>{if(e.key==='Enter')run(memeList)});

  const loadDmSettings=async()=>{
    const data=await request('/config');const cfg=data.config||{};
    $('dm-watch').checked=cfg.dmWatch===true;
    $('dm-stranger-enabled').checked=cfg.dmStrangerOnce===true;
    $('dm-whitelist').value=cfg.dmWhitelist||'';
    $('dm-interval').value=String(cfg.dmWatchMinutes??1);
    $('dm-reply-per-day').value=String(cfg.dmReplyPerDay??0);
    $('dm-stranger-max').value=String(cfg.dmStrangerMaxReplies??1);
    $('dm-first-fixed').checked=cfg.dmStrangerFirstFixed!==false;
    $('dm-welcome').value=cfg.dmStrangerText||'';
    $('dm-approval-enabled').checked=cfg.dmApprovalEnabled===true;
    $('dm-phrase').value=cfg.dmApprovalPhrase||'白饭🍚';
    $('dm-total').value=String(cfg.dmApprovedTotalLimit??50);
    $('dm-daily').value=String(cfg.dmApprovedDailyLimit??10);
    $('dm-wish-limit').value=String(cfg.dmWishMentionLimit??3);
  };
  const boundedInt=(id,min,max,label)=>{const n=Number($(id).value);if(!Number.isInteger(n)||n<min||n>max)throw Error(label+'必须是 '+min+'–'+max+' 的整数');return n};
  $('dm-settings-save').addEventListener('click',()=>run(async()=>{
    const phrase=$('dm-phrase').value.trim();if(!phrase||phrase.length>60)throw Error('申请暗号不能为空且最多60字');
    const welcome=$('dm-welcome').value;if(welcome.length>450)throw Error('欢迎语最多450字');
    const whitelist=$('dm-whitelist').value.trim();
    const payload={dmWatch:$('dm-watch').checked,dmStrangerOnce:$('dm-stranger-enabled').checked,
      dmWhitelist:whitelist,clear:[...(!whitelist?['dmWhitelist']:[]),...(!welcome.trim()?['dmStrangerText']:[])],
      dmWatchMinutes:boundedInt('dm-interval',1,120,'检查间隔'),
      dmReplyPerDay:boundedInt('dm-reply-per-day',0,1000,'每日自动回复上限'),
      dmStrangerMaxReplies:boundedInt('dm-stranger-max',1,20,'陌生人回复次数'),
      dmStrangerFirstFixed:$('dm-first-fixed').checked,dmStrangerText:welcome,
      dmApprovalEnabled:$('dm-approval-enabled').checked,dmApprovalPhrase:phrase,
      dmApprovedTotalLimit:boundedInt('dm-total',1,10000,'获批累计上限'),
      dmApprovedDailyLimit:boundedInt('dm-daily',1,1000,'获批每日上限'),
      dmWishMentionLimit:boundedInt('dm-wish-limit',1,10,'每条心愿@次数')};
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
    $('comment-top-count').value=String(c.commentTopCount??5);
    $('comment-top-videos').value=String(c.commentTopVideoCount??3);
    $('comment-per-poll').value=String(c.commentReplyPerPoll??1);
    $('comment-per-day').value=String(c.commentReplyPerDay??5);
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
      add(top,safeVideoLink(c.bvid),node('span',' · '+(c.kind==='reply'?'后台回复':'顶层评论')+' · '+(c.rpid?'rpid '+c.rpid:'未记录 rpid')));
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
  };
  const loadCommentsAll=async()=>{await Promise.all([loadCommentSettings(),loadRecentComments(),loadCommentsStatus()])};
  $('comments-settings-save').addEventListener('click',()=>run(async()=>{
    const payload={commentWatchReplies:$('comment-watch-replies').checked,commentWatchTop:$('comment-watch-top').checked,
      commentAllowGeneralTop:$('comment-allow-general-top').checked,
      commentTopCount:boundedInt('comment-top-count',1,20,'每视频热评数'),
      commentTopVideoCount:boundedInt('comment-top-videos',1,6,'每轮视频数'),
      commentReplyPerPoll:boundedInt('comment-per-poll',1,5,'每轮回复数'),
      commentReplyPerDay:boundedInt('comment-per-day',1,30,'每日回复数')};
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
  const loaders={diagnostics:loadDiagnostics,reports:loadReport,dm:loadDmAll,comments:loadCommentsAll,growth:growthList,meme:memeList};
  run(async()=>{await Promise.all([loadDiagnostics(),loadReport(),loadDmAll(),loadCommentsAll(),growthList(),memeList()]);switchTab('diagnostics')});
})();
