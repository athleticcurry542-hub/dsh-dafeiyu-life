# v2.4.77 · 「大肥鱼 · DSH 生活系统」品牌与项目叙事收束

这一版不以增加业务能力为主，而是把已经发展成完整角色生活系统的项目从旧名称 `dsh-bili-scroll-plus` 正式整理为：

- 包名：`dsh-dafeiyu-life`
- 展示名：**大肥鱼 · DSH 生活系统**
- GitHub 仓库：`minedalang/dsh-dafeiyu-life`
- DSH 设置入口：**大肥鱼**

## 为什么改名

现在的系统已经不只是“刷 B站增强版”：它有主 Session、主人相处、长期人格记忆、B站经历档案、成长经验、好友关系、梗知识、表情包、视频心愿、后台互动、配额、诊断和业务备份。

README 因此改为围绕“一只大肥鱼怎样在 DSH 里持续生活”来介绍，而不是继续堆每一版更新记录。

## 开源来源与致谢

README 前部与 DSH 设置页新增正式的开源来源说明，明确区分：

- `c1overzz/dsh-bili-scroll`：直接上游 / MIT；
- `adoresever/bilibili-mcp`：内置并修改的 Python MCP / MIT；
- `Yuuyuko-uu/dsh-fish-memory`：长期记忆设计与部分实现来源 / MIT；
- `Yuuyuko-uu/dsh-bili-subagent`：主 Session / “出去生活再回来”的架构启发，不打包其源码。

仓库继续保留根 LICENSE、第三方 LICENSE、`NOTICE.md`、`THIRD_PARTY_NOTICES.md` 与 `CONTRIBUTORS.md`。

## 改名与迁移

这次包名和 DSH 插件 ID 一并切换。内部 `/api/bili-duty` 与 `%DSH_HOME%/bili-duty/` 暂时保留作为数据/服务实现标识，避免没有价值的数据搬迁。

新备份格式写为 `dsh-dafeiyu-life-backup`，同时继续接受旧的 `dsh-bili-scroll-plus-backup`，方便现有唯一使用者完成迁移。
