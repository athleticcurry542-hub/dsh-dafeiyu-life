# 来源、衍生关系与版权说明

`dsh-dafeiyu-life`（**大肥鱼 · DSH 生活系统**）是一个独立维护的社区项目。它不是从零开始的原创工程，而是在多个开源项目基础上逐步演化而来。

## 1. 直接上游：c1overzz/dsh-bili-scroll

本项目最初基于 **c1overzz/dsh-bili-scroll** 二次开发。

- 上游仓库：https://github.com/c1overzz/dsh-bili-scroll
- 原作者：[@c1overzz](https://github.com/c1overzz)
- 许可证：MIT
- 根目录 `LICENSE` 保留上游版权声明和 MIT 正文。

来自该项目的核心历史包括 DSH 插件骨架、B站值班/日报思路以及早期运行结构。今天的代码已经经过大量重构与扩展，但代码血缘与来源不因改名而改变。

## 2. 内置 B站 MCP：adoresever/bilibili-mcp

`vendor/bilibili-mcp/` 基于 **bilibili-mcp** 持续修改：

- 上游：https://github.com/adoresever/bilibili-mcp
- 上游版权：Copyright (c) 2026 AGI_Ananas
- 许可证：MIT
- 完整许可：`vendor/bilibili-mcp/LICENSE`

本项目在其基础上增加了函数级权限、评论/私信业务边界、额度、诊断、表情包、视频上下文及其他适配；这些修改不代表上游作者为本项目提供支持或背书。

## 3. 内置长期记忆：Yuuyuko-uu/dsh-fish-memory

“大肥鱼的家”内置长期记忆基于 **dsh-fish-memory** 的设计与部分实现整合：

- 上游：https://github.com/Yuuyuko-uu/dsh-fish-memory
- 原作者：Yuuyuko-uu / Yuuyuko
- 许可证：MIT
- 上游许可：`vendor/fish-memory/LICENSE`

来源包括按 Session 保存的带时间记忆、淡忘机制、稳定事实、事实键、取代语义、作用域记忆工具和相关召回思路。本项目在其基础上做了 Claude/Anthropic schema 兼容、与 B站经历档案连接、管理 UI、备份恢复及权限隔离。

详细修改边界见 `THIRD_PARTY_NOTICES.md`。

## 4. 架构启发：Yuuyuko-uu/dsh-bili-subagent

- 参考仓库：https://github.com/Yuuyuko-uu/dsh-bili-subagent

该项目“让一个长期存在的 AI 伙伴拥有自己的会话，再把外出活动与回来汇报连接起来”的思路，对本项目后来形成“**主 Session 是家；后台插件是身体；精确账本是档案**”的架构有直接启发。

本仓库没有把 `dsh-bili-subagent` 的源码作为 vendor 第三方代码打包；这里属于明确的产品/架构致谢，而不是代码归属声明。

## 5. 社区贡献

部分修复和实现思路来自 Issue、PR 与社区测试反馈。已进入代码并记录的贡献见 `CONTRIBUTORS.md`。

---

本项目由 `minedalang/dsh-dafeiyu-life` 独立维护，不代表 DeepSeek、哔哩哔哩或上述任何上游作者的官方立场，也不暗示上游作者为本衍生项目提供支持或背书。

本文件只用于清楚说明来源与归属，不增加额外许可限制。
