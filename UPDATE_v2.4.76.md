# v2.4.76 · 大肥鱼内置长期记忆

## 这版解决什么

大肥鱼现在不再依赖单独安装 `dsh-fish-memory`。一个主人明确选择的 DSH 主 Session 仍然是“大肥鱼的家”，但长期记忆能力已经直接整合进 `dsh-bili-scroll-plus`。B站后台安全架构、精确账本、配额和权限都保持不变。

## 上游来源与许可

长期记忆设计和部分实现基于 MIT 项目：

- https://github.com/Yuuyuko-uu/dsh-fish-memory
- 原作者：Yuuyuko-uu / Yuuyuko
- 上游版本参考：1.3.3
- 原许可证保存在 `vendor/fish-memory/LICENSE`
- 详细整合边界见 `THIRD_PARTY_NOTICES.md`

本整合版由 `dsh-bili-scroll-plus` 独立维护，不代表上游作者为本整合版背书。

## 主要能力

- 主 Session 独立长期记忆：普通记忆会随时间淡忘，长期事实不随普通半衰期衰减。
- 事实键：同一件会变化的事实可保留最新值，旧值标为已取代而不是悄悄删除。
- `dafeiyu_remember`：只在已选择的主 Session 出现，用于记住主人重要的话、约定、偏好、关系和长期状态。
- Claude/Anthropic 兼容：所有 tool schema 参数名只使用 ASCII，避免严格 provider 因 `取代` / `事实键` 中文 key 返回 400。
- B站经历自动入记忆：新挑中的视频和大肥鱼自己发出的公开评论/回复直接从已有账本写入，不额外调用总结模型。
- 仍保留精确 `bili_experience_recall`：模糊人格记忆和精确 BV/rpid 档案各司其职。

## 从独立 dsh-fish-memory 迁移

1. 如果独立 `dsh-fish-memory` 正在管理这个 Session，先在旧插件里关闭该 Session，或直接卸载独立插件；它的 `%DSH_HOME%/fish-memory/` 记忆文件不会因此删除。
2. 完全重启 DSH，确保旧插件不再给该 Session 注入工具。
3. 升级本插件到 v2.4.76，再完全重启 DSH。
4. 打开你的“大肥鱼”主 Session。
5. 管理中心 → 大肥鱼的家 → 选择并保存该 Session。
6. 点击「导入旧 dsh-fish-memory 记忆」，确认长期记忆列表里出现旧数据。
7. 开启「内置长期记忆」。

旧 `%DSH_HOME%/fish-memory/` 文件不会被本插件删除。需要回滚时仍可保留。

## 正常使用

- 继续按原方式开启“大肥鱼总开关”和自定义时段；不需要在主 Session 手动命令她去刷 B站。
- 主人平时就在主 Session 和她正常聊天。值得长期记的内容，大肥鱼可以在同一轮调用 `dafeiyu_remember`。
- B站重要经历由插件自动进入长期记忆，无需额外总结 AI。
- 管理中心可查看/搜索/删除/手动补一条长期记忆。

## 数据与安全

- 内置记忆：`$DSH_HOME/bili-duty/long-term-memory/<session>.json`。
- 进入本插件业务数据备份。
- 不扫描 `~/.dsh/sessions`。
- 只挂到主人明确选择的主 Session。
- 不把 B站 Cookie、凭证或陌生人私信全文写入长期记忆。
- 后台刷 B站仍沿用 v2.4.74 的受限 headless overlay。
