import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseVideoWishes,updateVideoWishes,listActiveVideoWishes,reviewWishDecision,wishHardRejection,rotatingWishKeywords} from '../lib/video-wishes.mjs';
import {parseDmWhitelist} from '../lib/dm-inbox.mjs';
import {parseMentionTargets} from '../lib/mentions.mjs';
import {normalizeMentionProfiles,buildMentionProfilePrompt} from '../lib/character-social.mjs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
import {recentComments} from '../lib/recent-comments.mjs';

test('UID|备注昵称白名单仍只认 UID，好友也允许只写 UID',()=>{
 assert.deepEqual([...parseDmWhitelist('123|小甲\n456|小乙')],['123','456']);
 assert.deepEqual(parseMentionTargets('123\n乙|456'),[{name:'UID 123',uid:'123'},{name:'乙',uid:'456'}]);
 const info=normalizeMentionProfiles({乙:{relationship:'朋友',otherRelationships:'与小甲是同学',personality:'外向',interests:'美食',preferences:'不要出现在新提示词'}},'乙|456');
 assert.match(buildMentionProfilePrompt({targetsText:'乙|456',profiles:info}),/与小甲是同学/);
 assert.doesNotMatch(buildMentionProfilePrompt({targetsText:'乙|456',profiles:info}),/不要出现在新提示词/);
});
test('心愿审核不通过或未决不进搜索，审核通过才轮换最多两个主题',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2452-wishes-'));
 const p={approval:{status:'approved'}};
 const w=updateVideoWishes(p,'有那种美食视频，美女视频多艾特我一下',{uid:'123',now:1800000000000,reviewRequired:true});
 assert.equal(w.records.length,2);assert.equal(listActiveVideoWishes({people:{123:p}},dir,1800000000001).length,0);
 assert.equal(reviewWishDecision(w.records[0],null).decision,'pending');
 assert.equal(reviewWishDecision(w.records[0],{decision:'approve',reason:'正常的兴趣'}).decision,'approve');
 for(const rec of w.records){rec.status='active';rec.reviewedAt=1800000000001}
 assert.deepEqual(new Set(rotatingWishKeywords(listActiveVideoWishes({people:{123:p}},dir,1800000000002),1800000000002,2)),new Set(['美食','颜值']));
 assert.ok(wishHardRejection('给我找色情视频'));assert.equal(reviewWishDecision({requestText:'帮我找政治宣传视频'},{decision:'approve',reason:'随便批准'}).decision,'reject');
 assert.equal(parseVideoWishes('有那种美食视频多艾特我一下').topics[0],'美食');
});
test('老版未经审核的 active 心愿升级后自动改待审核且可重新审核',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2452-oldwish-'));
 const id='12345678-1234-1234-1234-123456789abc';
 await writeFile(join(dir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,sentAt:[],people:{123:{approval:{status:'approved'},videoWishes:[{id,uid:'123',topic:'美食',status:'active',limit:3,requestText:'帮我找美食视频',createdAt:1800000000000,expiresAt:1900000000000}]}}}));
 const dm=createDmAutoReply({dataDir:dir,now:()=>1800000000000,selfUid:'999',getConfig:()=>({enabled:false}),fetchIncoming:async()=>[],send:async()=>true,reviewWish:async()=>({decision:'approve',reason:'普通美食'}),logger:{warn(){},info(){},error(){}}});
 let records=await dm.listVideoWishes();assert.equal(records[0].status,'pending_review');
 const result=await dm.reviewVideoWish('123',id);assert.equal(result.status,'active');
 records=await dm.listVideoWishes();assert.equal(records[0].status,'active');
 const db=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'));
 assert.ok(db.people['123'].videoWishes[0].reviewedAt);
});
test('最近评论后台回复支持预览上一条评论，旧资料缺失显式空字符串',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2452-comments-'));
 await writeFile(join(dir,'seen.md'),'## 评论记录\n| BV1ignA6REjB | 321906225296 | 321906220000 | 2026-10-26 10:53:34 | 才不是脾气好 |\n');
 await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify({replyLabels:{'BV1ignA6REjB:321906225296':{recipientUid:'1217526350',recipientName:'来token来',recipientComment:'你明明就是脾气很好啊'}}}));
 const row=recentComments(dir).rows[0];assert.equal(row.recipientComment,'你明明就是脾气很好啊');assert.equal(row.recipientUid,'1217526350');
});
test('实际私信轮询：安全硬拦截优先于AI；正常心愿经AI批准后才可搜索',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2452-policy-'));let at=1800000000000;
 const inbox=[];let reviews=0;
 const dm=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>at,
  getConfig:()=>({enabled:true,whitelist:['123'],whitelistCooldownSeconds:0}),
  fetchIncoming:async()=>inbox,send:async()=>true,generateReply:async()=> 'SKIP',
  lookupNickname:async()=> '测试访客',
  reviewWish:async()=>{reviews++;return {decision:'approve',reason:'普通兴趣'}},
  logger:{warn(){},info(){},error(){}}});
 await dm.poll();
 await writeFile(join(dir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,sentAt:[],people:{123:{seen:[],history:[],approval:{status:'approved'}}}}));
 const msg=(id,text)=>({incoming:true,senderUid:'123',messageId:id,text,timestampMs:at});
 inbox.push(msg('x1','帮我找色情美女视频多艾特我一下'));
 await dm.poll();
 let rows=await dm.listVideoWishes();assert.equal(rows[0].status,'rejected');assert.equal(reviews,0);
 at+=2000;inbox.push(msg('x2','给我找点好吃的美食视频'));
 await dm.poll();rows=await dm.listVideoWishes();
 assert.equal(rows.find(x=>x.topic==='美食').status,'active');assert.equal(reviews,1);
 assert.equal((await dm.listRecentConversations())[0].nickname,'测试访客');
});
