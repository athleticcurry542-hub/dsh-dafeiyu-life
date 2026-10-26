import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
const interact=readFileSync(new URL('../lib/comment-interact.mjs',import.meta.url),'utf8');

test('每日诊断界面为诊断列表提供独立滚动区',()=>{
  assert.match(html,/records records-scroll/);
  assert.match(html,/records-scroll tall/);
  assert.match(html,/diag-grid/);
});

test('每日诊断中的通知卡片使用评论深链与评论预览',()=>{
  assert.match(js,/safeCommentLink\(/);
  assert.match(js,/对方这条：/);
  assert.match(js,/上一层上下文：/);
});

test('通知诊断记录持久化 rpid root 与评论文本',()=>{
  assert.match(interact,/rpid:validId\(x\.rpid\)/);
  assert.match(interact,/root:validId\(x\.root\)/);
  assert.match(interact,/text:String\(x\.text\|\|''\)\.trim\(\)\.slice\(0,800\)/);
});
