import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const code=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
test('MCP emits reason when AI declines and does not mistake text for notification',()=>{
  for(const marker of ['ai_declined','ai_selected_no_names','no_mention_targets','mentioned_text_only_missing_uid','uid_mapping_submitted_unverified','_record_mention_event']) assert.ok(code.includes(marker),marker)
})
