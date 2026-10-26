import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {readCommentMemeRules,saveCommentMemeRules,validateCommentMemeRules,RULE_FILE} from '../lib/comment-meme-rules.mjs'
import {createBackup,validateBackup,restoreBackupFiles} from '../lib/data-backup.mjs'
const pluginDir=fileURLToPath(new URL('..',import.meta.url))
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')

test('管理中心可查看、修改、禁用、组合、导入导出和测试规则',()=>{
  const ui=source('lib/management-console.html'),js=source('lib/management-console.js'),index=source('index.js')
  for(const id of ['meme-rule-list','meme-rule-save','meme-rule-add','meme-rule-default','meme-rule-export','meme-rule-import','meme-rule-test']) assert.match(ui,new RegExp(id))
  for(const k of ['triggers','targets','requireAny','excludeAny']) assert.match(js,new RegExp(k))
  assert.match(index,/\/api\/bili-duty\/comment-meme-rules\/preview/)
  assert.match(index,/validateCommentMemeRules/)
  assert.match(source('lib/state.mjs'),/comment_meme_search.py/)
  assert.match(source('lib/state.mjs'),/comment_meme_rules_default.json/)
})

test('默认规则与自定义规则在同一 Python/Node 结构中验证并持久化',()=>{
  const root=mkdtempSync(join(tmpdir(),'meme-rule-'))
  try{
    const old=readCommentMemeRules(root,pluginDir)
    assert.equal(old.customized,false)
    assert.ok(old.data.rules.find(r=>r.id==='fridge-meal').requireAny.includes('白饭'))
    const edited=structuredClone(old.data)
    edited.rules.find(r=>r.id==='laugh').enabled=false
    edited.rules.push({id:'owner-rule',label:'主人自定义',enabled:true,triggers:['好厉害'],targets:['鼓掌'],requireAny:[],excludeAny:['讽刺']})
    saveCommentMemeRules(root,edited)
    const reread=readCommentMemeRules(root,pluginDir)
    assert.equal(reread.customized,true)
    assert.equal(reread.data.rules.at(-1).label,'主人自定义')
    assert.equal(reread.data.rules.find(r=>r.id==='laugh').enabled,false)
    assert.throws(()=>validateCommentMemeRules({...edited,rules:[...edited.rules,edited.rules[0]]}),/重复/)
    assert.throws(()=>validateCommentMemeRules({...edited,rules:[{...edited.rules[0],triggers:[]}]}),/triggers/)
    assert.throws(()=>validateCommentMemeRules({...edited,rules:[{...edited.rules[0],targets:['\u0000'] }]}),/targets/)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('规则文件进入业务备份并被恢复，但图片始终不在备份内',()=>{
  const root=mkdtempSync(join(tmpdir(),'meme-backup-'))
  const restored=mkdtempSync(join(tmpdir(),'meme-restore-'))
  try {
    saveCommentMemeRules(root,readCommentMemeRules(root,pluginDir).data)
    const backup=createBackup({root,config:{commentMemesEnabled:true},sqlite:{}})
    assert.ok(backup.files[RULE_FILE]?.includes('triggers'))
    assert.deepEqual(validateBackup(backup).count,1)
    restoreBackupFiles(restored,backup)
    assert.ok(existsSync(join(restored,RULE_FILE)))
    assert.deepEqual(readCommentMemeRules(restored,pluginDir).data.rules,readCommentMemeRules(root,pluginDir).data.rules)
    assert.doesNotMatch(JSON.stringify(backup),/\.webp/)
  }finally{rmSync(root,{recursive:true,force:true});rmSync(restored,{recursive:true,force:true})}
})
