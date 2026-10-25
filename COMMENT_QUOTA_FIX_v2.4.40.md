# v2.4.40 评论额度统计修复包

## 覆盖文件

解压到 `dsh-bili-scroll-plus` 仓库根目录，允许同名文件覆盖：

- `package.json`：版本升至 2.4.40
- `README.md`、`CHANGELOG.md`：同步版本与修复说明
- `index.js`：向后台评论互动传入全局每日评论上限
- `lib/comment-interact.mjs`：区分发送结果、记录额度拦截，并在全局额度耗尽时暂停后续后台调用
- `lib/management-console.html`、`lib/management-console.js`：分别显示滚动 24 小时后台回复额度与自然日全局额度
- `vendor/bilibili-mcp/mcp_server.py`：额度只读预检；在真实评论发布 API 调用前原子占位
- `test/`：新增回归测试并更新配额测试

## 安装

1. 先备份当前仓库或提交已有改动。
2. 将 ZIP 解压到仓库根目录并覆盖同名文件。
3. 在仓库根目录检查：

   ```bash
   node --check index.js
   node --check lib/management-console.js
   python -m py_compile vendor/bilibili-mcp/mcp_server.py
   ```

4. 提交并推送到 GitHub `main`，再从 DSH Desktop 更新插件并完全重启。
5. 打开「设置 → 刷B站 → 打开管理中心 → 最近公开评论记录」，点「刷新状态与记录」。

## 新统计口径

- **后台互动回复额度**：滚动 24 小时成功回执数 / 后台回复上限。
- **公开评论全局硬上限**：自然日内已预留的真实发布尝试 / 全局上限。主动主评论和后台回复共用。
- **发送结果分类**：从本版本开始记录成功回执、明确失败、结果不确定、额度拦截、其他拦截和中断待核实。
- **平台可见性**：成功回执或本地账本记录不等于 B 站当前公开可见；本页面不会把未核验记录标成可见。

全局 SQLite 额度账本会保留，不要为了更新而删除 `public-comment-quota.sqlite3`。v2.4.39 当天的旧计数可能包含发布前校验阶段占位，历史数据无法准确拆分；从 v2.4.40 的新发送开始按修正后的时机计数。

## 本地验证

- Node 测试：183 项通过。
- Python 测试：96 项通过，另有 15 个子测试通过。
- Node 语法检查、Python 编译检查及 DSH 插件自检通过。
- 尚未在真实 DSH Desktop + B 站账号环境中执行评论发布验证。
