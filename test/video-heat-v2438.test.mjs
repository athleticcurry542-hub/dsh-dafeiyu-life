import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {judgeVideoHeat} from '../lib/video-heat.mjs';
const limits={views:1000,likes:10,replies:3};
test('播放点赞评论三项必须达标；高播放量不能替代无互动',()=>{
 assert.equal(judgeVideoHeat({stat:{view:999,like:200,reply:50}},limits).ok,false);
 assert.equal(judgeVideoHeat({stat:{view:100000,like:0,reply:0}},limits).ok,false);
 assert.equal(judgeVideoHeat({stat:{view:1000,like:10,reply:3}},limits).ok,true);
});
test('缺数据时保守拒绝，未开启的阈值允许缺失',()=>{
 assert.match(judgeVideoHeat({stat:{view:2000,reply:4}},limits).reason,/未取得点赞数/);
 assert.equal(judgeVideoHeat({stat:{view:2000}}, {views:1000,likes:0,replies:0}).ok,true);
 assert.equal(judgeVideoHeat({},limits).ok,false);
});
test('发送工具确实在 bili_reply 前复核，选片提示要求详情核对，评论回复独立',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 assert.match(index,/heatInfo = await call\('bili_video_info'/);
 assert.match(index,/judgeVideoHeat\(heatInfo/);
 assert.match(index,/if\(!heat.ok\) return \{ok:false,blocked:true/);
 assert.match(index,/选片热度硬条件/);
 assert.match(index,/minVideoViews: z\.natural\(\)\.default\(1000\)/);
 assert.match(index,/minVideoLikes: z\.natural\(\)\.default\(10\)/);
 assert.match(index,/minVideoReplies: z\.natural\(\)\.default\(3\)/);
 assert.match(index,/必须在决定写入日报的 ### BV 入选段落/);
 assert.match(index,/不要为了凑每轮名额降低标准/);
 const client=readFileSync(new URL('../client.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
 assert.match(html,/最低播放量/);assert.match(html,/最低点赞数/);assert.match(html,/最低评论数/);
});
