# 大肥鱼 Plus v2.4.74 · Headless 隐私隔离与新机安全启动

## 为什么重做
此前讨论的风险不是“提示词不够严格”，而是无人值守 Agent 如果裸用 DSH `headless`，可能仍看到宿主自带的文件、Shell、Web、子代理等工具。v2.4.74 直接从能力层收口，不依赖模型自觉。

## 三条 AI 路径
- `headless-overlay.yml`：主动刷视频、选片、主评论。
- `headless-dm-overlay.yml`：私信、评论回复、被 @、人工要求 AI 回复等互动生成；不挂 B站发送 MCP，由宿主在模型返回纯文本后再执行受控发送。
- `headless-vision-overlay.yml`：独立视觉模式，仅挂 `bili_preview_vision`。

## 新电脑
插件加载后会主动生成主/DM 两份 overlay；如果启用独立视觉，会在需要时生成视觉 overlay。文件不是用户手工前置条件。每次 AI 启动前都会按当前模型/额度/白名单重新生成和验证，因此旧文件删掉也能重建。

## 强制安全规则
48 项高危 DSH 能力必须明确关闭，包括文件系统、PowerShell/Bash、Web fetch/search/browser、子代理、workflow、skill、plugin manager、session/file reference、Python/code/execute/process 等。无人值守轮固定使用 `headless` profile；旧 `headlessProfile` 配置只为迁移保留，不再参与启动。

主/互动/视觉三类 overlay 的形状也会分别校验：主轮必须有 `mcp-bili-duty` 和 `BILI_MCP_TOOLS` 白名单；互动轮不得挂任何 MCP；视觉轮只能有 `mcp-bili-vision-readonly` 且工具白名单必须恰好为 `bili_preview_vision`。

## 失败策略
安全文件缺失、被改坏、出现符号链接、某个危险工具重新启用、profile/patch 参数异常时，直接拒绝启动对应 AI 轮，而不是降级为裸 `headless`。管理中心和非 AI 本地功能仍可用。

## 与 v2.4.73 的其它功能
保留 v2.4.73 的本地目录备份、81 条表情包规则备份恢复、规则编辑区即时测试、评论/私信/动态/成长记忆等逻辑。
