import test from 'node:test'
import assert from 'node:assert/strict'
import {parseMentionTargets, decideMentions, composeMentionComment} from '../lib/mentions.mjs'
const people=parseMentionTargets('长条动物|12345\n俺爱啃猪蹄子|87654')
test('旧 mentionName 兼容且不影响名单',()=>assert.deepEqual(parseMentionTargets('', '长条动物'), [{name:'长条动物',uid:''}]))
test('新名单覆盖旧昵称并带上所有 UID',()=>assert.deepEqual(parseMentionTargets('甲|123\n乙|456','老昵称'),[{name:'甲',uid:'123'},{name:'乙',uid:'456'}]))
test('AI 模式：默认不 @',()=>assert.equal(decideMentions({mode:'ai',targets:people}).shouldMention,false))
test('AI 模式：显式想分享才 @',()=>assert.equal(decideMentions({mode:'ai',targets:people,shouldMention:true}).shouldMention,true))
test('关闭模式无论模型如何决定都不 @',()=>assert.equal(decideMentions({mode:'off',targets:people,shouldMention:true}).shouldMention,false))
test('每条都 @ 不能被模型 false 关闭',()=>assert.equal(decideMentions({mode:'always',targets:people,shouldMention:false}).shouldMention,true))
test('回复楼中楼不向所有人推送 @',()=>assert.equal(decideMentions({mode:'always',targets:people,isReply:true}).shouldMention,false))
test('触发时一次带上全部目标',()=>{const x=composeMentionComment('好家伙',people,true);assert.equal(x.text,'好家伙 @长条动物 @俺爱啃猪蹄子')})
test('句中 @ 不固定句首',()=>{const x=composeMentionComment('救命！这也太离谱了',people,true,'middle');assert.match(x.text,/救命！ @长条动物 @俺爱啃猪蹄子 这也太离谱了/)})
test('不触发时移除已有的配置 @',()=>assert.equal(composeMentionComment('绝了 @长条动物',people,false).text,'绝了'))
test('名单为空可正常只发普通评论',()=>assert.equal(composeMentionComment('看傻了',[],true).text,'看傻了'))
