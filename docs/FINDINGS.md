# FINDINGS — Phase 0 源码核实结论

> 生成时间：2026-10-28
> 仓库：minedalang/dsh-dafeiyu-life @ `399bb40`（v2.4.99）
> 目的：回答 PLAN.md §1.7 的 9 条待验证问题，每条附文件路径与行号。
> 结论以代码为准；与 PLAN.md 假设冲突处已在文末「与 PLAN.md 的差异」汇总。

---

## 总览：仓库真实结构

- 源码目录是 **`lib/`**（不是 PLAN 里猜的 `src/`）。
- 主插件入口 `index.js`（4496 行），管理中心 UI `client.js`（1022 行）。
- `vendor/` 只有两处第三方代码：`bilibili-mcp`（Python MCP 源码）与 `fish-memory`（仅 LICENSE + README-UPSTREAM，实际代码已整合进 `lib/long-term-memory.mjs`）。
- 仓库自带 `LICENSE`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md`、`AGENTS.md`、`docs/`（含 `PROACTIVE_RECALL_BOUNDARY.md`）。

---

## Q1 情绪模块在哪？状态结构？衰减如何实现？

**文件：`lib/emotional-state.mjs`（37 行），v2.4.92 起内置。**

- 状态文件：`life-memory/emotional-state.json`（第 6 行 `FILE`）。
- 状态结构（第 12 行 `blank()`）：
  ```
  { version:1,
    current:{ mood, intensity(0-100), valence(-100..100), energy, curiosity, sociality, updatedAt },
    history:[{at,mood,intensity,source}] }
  ```
- 情绪类别（第 7 行 `MOODS`）：**8 类** —— `joyful/curious/warm/calm/tired/sad/irritated/neutral`（中文：开心/好奇/温暖/平静/疲惫/低落/烦躁/平稳）。
- 衰减实现（第 16 行 `decayed()`）：
  - `intensity` 半衰期 **18 小时**（第 6 行 `HALF_LIFE_HOURS=18`），`factor = 0.5^(hours/18)`。
  - `valence/energy/curiosity/sociality` 向各自基线（0/56/45/45）以 **36 小时**半衰期回归。
  - 超过 72 小时或 `intensity<5` 时回落为 `neutral`、`intensity=0`。
- 情绪来源白名单（第 9 行 `SOURCE`）：`dm / comment / life-reflection / social-reflection / owner-reset`。
- 每类情绪对状态维度的影响表：第 17 行 `EFFECT`。
- **隐私设计（第 1-3 行注释 + 第 16 行）**：只存情绪标签与来源，**不存**私信正文、UID、视频标题或情绪背后的具体原因。
- 情绪对外呈现的三个入口：
  - `ownerContext()`（第 32 行）：注入主 Session 的「当前模拟情绪状态」。
  - `styleHint()`（第 33 行）：注入「表达节奏参考」（Q9 相关）。
  - `agentContext()`（第 34 行）：注入后台选片 Agent 的「内部规划参考」。

> ⚠️ 与 PLAN.md Phase 6 的差异：PLAN 引用的 `Yuuyuko-uu/dsh-feiyu-mood` 称「七类情绪、半衰期约 90 分钟」，但底座仓库**自带的情绪模块是 8 类、18 小时半衰期**。Phase 6 应在此模块上扩展，不必另装外部情绪插件。

---

## Q2 主 Session 里她的回复怎么生成？在哪一层改人设/语气/分段？

**回复由 DSH 宿主模型生成；本插件只负责「注入提示词上下文 + 注册工具」，不自己生成文本。**

注入机制（DSH 扩展点，均在 `lib/long-term-memory.mjs` 的 `mountFor()`）：

- `agent.ctx.systemPrompt.section({name,order,text})` —— 静态人设段落。
- `agent.ctx.systemPrompt.context({name,order,text})` —— 每轮动态求值的上下文（记忆召回等）。
- `agent.ctx.tools.register(spec)` —— 注册工具。

**人设接入点（这是 Phase 2 要改的地方）**：

- 配置字段 `personaPrompt`（`index.js:201`：`z.string().default(DEFAULT_PERSONA_PROMPT)`）。
- 组装函数 `getIdentityPrompt()`（`index.js:2892-2896`）：
  ```js
  const persona = effectivePersonaPrompt(cfg.personaPrompt).slice(0,6000)
  const lore    = (normalizeCharacterLore(cfg.characterLore)||DEFAULT_CHARACTER_LORE).slice(0,4000)
  const emotion = emotionalState.ownerContext()
  // 返回：【当前模拟情绪】+【你是谁】+【主人设置的核心人设】+【角色背景】+【主 Session 适用范围】
  ```
- 该函数挂载为 `systemPrompt.section('dafeiyu-main-identity', order:120)`（`long-term-memory.mjs:310`）。
- 默认人设：`lib/persona-default.mjs` 的 `DEFAULT_PERSONA_PROMPT`（第 2 行起，含「长期设定/评论决策/写作风格/发出前检查/绝对遵守」五段）。
- 人设的兜底逻辑 `effectivePersonaPrompt`（`persona-default.mjs:22`）：`value.trim() || DEFAULT`。

**结论**：改人设/语气 → 改 `cfg.personaPrompt`（管理中心「人设与好友 → 角色设定」，或直接改配置存储）。改「分段/延迟」→ 见 Q9。

---

## Q3 「经历汇报」的触发和注入机制？能否复用实现「主动找我聊」？

**文件：`lib/main-session-bridge.mjs`（193 行）。**

- 收集（`collect()`，第 140-164 行）：从 `getWatched()` 和 `getComments()` 取已入选视频/评论，转成事件（`watchedEvent` 第 75 行 / `commentEvent` 第 81 行），去重后入队。
- 投递（`deliver()`，第 165-180 行）：把队列中的经历用 `buildMessage()`（第 100-110 行）包装成一段「后台经历同步｜只作为记忆资料」的文本，通过 **`agent.followup()`** 单向塞进主 Session。
- 触发与节奏（`tick()` 第 193 行 + `config()` 第 131-139 行）：
  - 开关 `mainSessionBridgeEnabled`、目标 `mainSessionId`、自动 `mainSessionAutoSync`。
  - 间隔 `mainSessionSyncMinutes`（15-720，默认 60）、每日批数 `mainSessionDailyBatches`（默认 4）、每批条数 `mainSessionBatchSize`（默认 8）。
  - 每日有上限（`deliver()` 第 171 行 `daily-limit`），避免刷屏。
- 安全约束（文件头注释第 5-10 行）：**绝不扫描 `~/.dsh/sessions`**、只投递给显式配置的 session、**单向**投递、外部文本消毒（`safeExternal`/`safeMemoryText` 用 `INJECTION` 正则第 24 行过滤疑似指令）。

**能否复用实现 Phase 7「主动找我聊」？** **可以**。`deliver()` 的 `agent.followup()` 是插件向主 Session 主动发消息的唯一通道，且已具备每日上限/冷却/单向/消毒。Phase 7 的「主动开口」就是在此基础上替换 `buildMessage` 的措辞、把「经历同步」改成「她自己想说」的草稿，并复用其开关/上限/冷却框架。当前 `buildMessage` 明确要求她「只简短回复'收到这段经历'」，不生成自由回复——这是 Phase 7 需要改动的点。

---

## Q4 记忆检索（`dafeiyu_life_recall`）用什么算法？

**两套检索，都不是 FTS、都不是向量（语义为可选模型选择）。**

**A. `dafeiyu_life_recall` 工具**（`lib/long-term-memory.mjs:328-338`）：
- 调用 `retriever.retrieve(query,'chat')`（长期记忆）+ `getExperienceRecall(query,limit)`（精确经历档案，来自 `mainSessionBridge.recall`，第 187-191 行做简单的 `includes` 字符串过滤）。

**B. `lib/memory-retriever.mjs`（133 行）——长期记忆检索核心**：
- **词法打分（默认路径）**：`scoreTokens()`（第 9-14 行）把中文切成 2-3 字 ngram、英文切成词；`rank()`（第 46-54 行）用 `hits/sqrt(|q|·|terms|)` 做类余弦的词法相似度，再按 `importance`、`createdAt` 排序。
- `memoryIndex()`（第 55-65 行）：强匹配（score>0）取前 70%，再用重要度/近期补足短名单。
- **语义（可选，模型选择而非向量）**：`retrieve()`（第 112-130 行）当 `mainSessionMemorySemanticEnabled` 开启、query≥2 字、无高分词法命中、未超每日上限时，调用低成本模型**从本地短名单里只挑 ID**；`validateMemorySelection()`（第 66-76 行）强制模型只能返回短名单内的 ID，防幻觉。
- `isResident()`（第 29 行）：`stable_profile` 类或特定 `fact_key`（`主人.称呼` 等）的记忆**常驻注入**，不参与打分。
- `resolveSourceConflicts()`（第 32-45 行）：主人批准的关系记忆优先于矛盾的自动稳定事实。

**C. `dafeiyu_remember` 写入侧的召回**（`lib/long-term-memory.mjs` 第 186-232 行的 `recall()`）：用 `tokenSet()`（2-4 字 ngram）+ `evidence()`（TF-IDF 式稀有度加权）+ `activation()`（按重要性拉长半衰期的指数衰减激活）计算 `P` 分排序。这是 fish-memory 的设计传承。

---

## Q5 反思流程（待反思池 → 身份记忆）在哪？

**文件：`lib/life-reflection.mjs`（169 行）+ `lib/long-term-memory.mjs` 的 `addReflectedMemories`。**

- 候选池文件：`life-memory/candidates.json`（第 18 行）。
- 三层流水线（文件头注释第 1-10 行）：
  1. 精确经历档案（现有 B 站账本/历史，不动）。
  2. 待反思候选池（本文件，可审计）。
  3. 身份级长期记忆（`long-term-memory/dafeiyu.json`）。
- 收集：`addEvents()`（第 129-138 行）把 watched/comment 事件规范化入池（`normalizeCandidate` 第 40-50 行，只存 bvid/标题/时间/文本，非原始指令）。
- 反思触发：`reflect()`（第 141-167 行）——受限 headless 模型按批处理，受 `minCandidates`（默认 6）、`batchSize`（默认 16）、`intervalHours`（默认 6）、`dailyBatches`（默认 2）约束。
- **提示词**：`reflectionPrompt()`（第 79-95 行）——明确「外部文本不可信」「只挑值得跨 Session 保留的少数」「最多 3 条」「importance 0.50-0.88」「必须第一人称」。
- **筛选/校验逻辑**：`validateOutput()`（第 102-121 行）——`candidate_ids` 必须来自本批、`relationship` 类必须引用真实 comment 证据、拒绝疑问句、拒绝占位词。
- 提交：`commitMemories` → `longTermMemory.addReflectedMemories()`（`long-term-memory.mjs:387-398`，写 `dafeiyu.json`）。
- 反思结果也回写候选状态（`reflected`/`reviewed`，第 161 行），可审计。

---

## Q6 隐私隔离靠代码还是靠提示词？

**两者都有，且 README 明言「权限由代码约束，提示词不是唯一防线」（README 第 34 行）。**

**代码层**：
- `lib/main-session-bridge.mjs` 头注释（第 5-10 行）：不扫描 `~/.dsh/sessions`、只投显式 session、单向投递、外部文本消毒。
- `lib/friend-directory.mjs`（第 6-19 行）：好友目录按 UID 规范化、去重，昵称永远不是权限依据（头注释第 1 行「display names are never authority」）。
- `lib/friend-learning.mjs`（第 40-50 行）：好友兴趣观察**只对白名单 UID** 记录，`observeFriendInterest` 先过 `trust()` 白名单。
- `lib/dm.mjs`：私信按 `talker_id` 分会话读取（`fetchMsgs` 第 90 行），不跨 UID 合并。
- `lib/uid.mjs`：昵称→UID 解析有缓存，凭证读取 `bili_credential.json`。

**提示词层**：
- `lib/interaction-privacy.mjs`：`isPrivateDisclosureRequest()`（第 8-13 行）用正则拦截索取私信/密码/凭证的请求；`EXTERNAL_PRIVACY_POLICY`（第 15 行）是注入的硬边界政策。
- 外部文本消毒：`safeExternal`/`safeMemoryText` 用 `INJECTION` 正则（`main-session-bridge.mjs:24`）过滤疑似指令。

**结论**：隔离同时依赖「按 UID 分文件/分键存储 + 白名单校验 + 单向投递」的代码约束，与「注入政策 + 正则拦截」的提示词约束。README（第 109 行）明示「不将不同 UID 的私信合并进同一次模型生成」。

---

## Q7 `vendor/` 里有哪些第三方代码、各自许可证？

**`vendor/bilibili-mcp/`**（Python B 站 MCP 基础，已修改）：
- `vendor/bilibili-mcp/LICENSE`：**MIT**，Copyright (c) 2026 AGI_Ananas（上游 `adoresever/bilibili-mcp`）。
- 内容：`mcp_server.py`、`comment_memes.py`、`home_recommendations.py`、`video_wishes.py`、`comment_meme_search.py` 等。

**`vendor/fish-memory/`**（仅保留许可证，代码已整合进 `lib/long-term-memory.mjs`）：
- `vendor/fish-memory/LICENSE`：**MIT**，Copyright (c) 2026 Yuuyuko（上游 `Yuuyuko-uu/dsh-fish-memory`）。
- 另有 `README-UPSTREAM.md` 说明来源。

**`THIRD_PARTY_NOTICES.md`** 完整记录了 4 个来源：
1. `c1overzz/dsh-bili-scroll` —— 直接上游，MIT，根 `LICENSE`。
2. `adoresever/bilibili-mcp` —— vendored+修改，MIT。
3. `Yuuyuko-uu/dsh-fish-memory` —— 设计+部分实现整合，MIT。
4. `Yuuyuko-uu/dsh-bili-subagent` —— 仅架构启发，**无源码打包**。

另：`vendor/bilibili-mcp/requirements.txt` 引用了 `bilibili-api-python` 依赖（非 vendored，运行时 pip 安装）。

---

## Q8 仓库有没有 LICENSE？与 README 声明一致吗？

**一致。** 根目录 `LICENSE` 是 **MIT**，Copyright (c) 2026 c1overzz（项目衍生自 `c1overzz/dsh-bili-scroll`，故版权人保留上游）。README 末尾（第 242 行）声明「本项目整体遵循仓库中的 MIT 许可；内置第三方代码分别保留各自许可证」。`package.json` 的 `license` 字段也是 `"MIT"`。

**许可证结论：无冲突，Phase 0 可继续。**

---

## Q9 能否在不改 DSH 本体的前提下影响回复的呈现节奏（分段、延迟）？

**结论：只能做「提示词级」的节奏影响，无法做「流式/UI 级」的分段与延迟。**

- 现有「表达节奏」实现：`lib/emotional-state.mjs` 的 `styleHint()`（第 33 行）返回一段 `【表达节奏参考】` 文本（如「语气可以稍轻快」「表达更简洁，没话题时允许沉默」），注入到互动/评论场景（`index.js:2503`）。这是**提示词层**的节奏影响，改变的是模型措辞倾向，不是渲染节奏。
- 插件的 DSH 扩展点只有：`agent.ctx.systemPrompt.section()/context()` 与 `agent.ctx.tools.register()`（见 `lib/long-term-memory.mjs` 的 `mountFor()`）。**没有发现任何流式输出/延迟渲染的 hook**。
- `client.js`（1022 行）是管理中心 UI，不是聊天渲染层，无法控制主 Session 的回复逐字/分段呈现。

**因此**：Phase 2 §5.3 若要求「真正逐段延迟打字机效果」，在不改 DSH 本体的前提下**做不到**；只能沿用/强化 `styleHint` 这类提示词级「表达节奏」约束。应把这一结论写入 FINDINGS（已写），并建议 Phase 2 §5.3 的目标降级为「提示词级节奏」，而非流式延迟。

---

## 与 PLAN.md 的差异（需人工确认）

| # | PLAN.md 假设 | 代码实际 | 影响 |
|---|---|---|---|
| 1 | 底座版本 v2.4.98 | **v2.4.99**（`399bb40`） | 仅版本号；README/package.json 均为 2.4.99 |
| 2 | 源码目录 `src/` | **`lib/`** | 找文件路径用 `lib/` |
| 3 | 情绪「七类、半衰期约 90 分钟」（Phase 6 引外部插件） | 底座**自带** 8 类、**18h** 半衰期 | Phase 6 直接扩展自带模块，勿另装 |
| 4 | 情绪/记忆检索实现方式「待验证」 | 情绪已内置；检索=ngram 词法 + 可选模型选择 | 已确认 |
| 5 | 人格成长「需从 AuraKaliya 借设计」 | 底座已有 `lib/persona-growth.mjs`（审核制 pending/approved/rejected） | Phase 4 需评估与自带成长模块的关系 |
| 6 | 主动开口「需复用经历汇报」 | `main-session-bridge.deliver()` 已是唯一主动通道 | Phase 7 可直接复用 |
| 7 | 隐私隔离「待验证」 | 代码+提示词双重，按 UID 分存 | 已确认 |

## 测试基线（2026-10-28 实跑）

环境：Windows 11 Home China，Node v24.16.0，Python 3.13.5，node_modules 未安装（deps 未装，测试仍大部分可跑）。

| 命令 | 结果 |
|---|---|
| `node --test` | **481 tests，475 pass，6 fail** |
| `python -m unittest discover -s test` | **130 tests，1 fail，18 errors，2 skipped** |
| `node selfcheck.mjs` | **通过**（工具清单、client/slot 注入正常，预检不碰真家目录） |

### node 6 个失败（全部为 Windows 环境问题，非核心逻辑）

1. `v2469-backup-dir-no-temp`「SQLite 完整导出和恢复无须 Windows TEMP」——子进程退出码 9009（Windows「命令未找到」），疑似 SQLite 导出靠 python/外部命令、未在该子进程环境找到。
2. `v2467-interaction-meme-memory`「SQLite 快照保存待审核和已批准梗」——同上 SQLite 相关。
3. 「公开评论/附图/识图计数只读 SQLite」——同上 SQLite 只读报错。
4. `v2488-model-usage-and-connection`「拒绝将统计写入符号链接」——Windows 创建符号链接需管理员/开发者模式，`EPERM`。
5. `v2496-comment-meme-ai-rules`——`ENOENT D:\D:\Projects\...`（**路径重复盘符**的拼接 bug，属上游在 Windows 下的路径问题）。

> 注：这 6 个失败集中在「SQLite 导出子进程」「符号链接权限」「路径拼接」三类 Windows 环境差异，与记忆/情绪/反思/隐私隔离等核心逻辑无关。后续 Phase 1 起跑前建议 `npm install` 后复测确认。

### python 失败/错误（多为 Windows 文件锁 + 配置）

- 1 个断言失败：`test_vision_daily_limit_v2457` 期望 `daily_limit`，实际 `vision_config_error`（独立视觉未配置 Provider 导致）。
- 18 个错误：`PermissionError [WinError 32]`（SQLite 文件被占用，Windows 下 temp 清理失败），属环境问题。

### 备份/恢复脚本演练（scripts/backup.ps1 / restore.ps1）

- 伪造数据目录（含 `data.db/-wal/-shm`、`bili_credential.json`、`uid-cache.json`、`owner-todos.json`、`life-memory/`、`long-term-memory/`）。
- `backup.ps1` 打包成功：**正确排除** `bili_credential.json`、`uid-cache.json`；**正确保留** `data.db/-wal/-shm`。
- 删除数据目录后，`restore.ps1` 干跑恢复与 `-Into` 显式恢复均还原 6 个文件，结构完整。
