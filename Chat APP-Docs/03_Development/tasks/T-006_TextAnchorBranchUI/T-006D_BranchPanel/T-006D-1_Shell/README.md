# T-006D-1 Branch Panel 壳子原型

**日期**：2026-05-20 深夜
**阶段**：T-006 / T-006D（拆为 D-1 ~ D-N 渐进）
**状态**：✅ 代码 + 自动化校验完成；⏳ 待用户手动验证 + commit

## 一句话

把 T-006C 占位 logger 的两个菜单 handler 升级为"打开 BranchPanel"：菜单点击 → 把 `{messageId, blockId, selectedText}` 推到 `Messages.tsx` 的 state → Dialog 弹出显示锚点字段 + 追问输入框 + 取消 / 创建分支按钮。"创建分支" 仅 `logger.debug` 不真 fork。

## 文件

- [任务.md](./任务.md) — 任务 brief
- [实施.md](./实施.md) — 改动清单 + 设计决策 + 校验
- [验证.md](./验证.md) — 自动化结果 + 手动验证步骤
- [完成总结.md](./完成总结.md) — 结果 / 遗留 / 给 D-2 的接口

## 与父 T-006D 的关系

| 子步 | 范围 | 状态 |
|---|---|---|
| **D-1（本任务）** | Dialog 壳子 + state 串联 + 字段显示 + 占位 handler | ✅ |
| D-2 | `useBranchAnchors` cache hook + `POST /topics { sourceNodeId }` fork 调用 + 切到新 topic | ⏳ |
| D-3（可选） | Sheet/Drawer 改造（侧滑面板）+ "针对此处提问" 注入 inputbar 分支 | ⏳ |

D-1 故意没做 cache（用 React local state）、没做 fork（创建按钮只 log）、没改 inputbar —— 严守 scope 让 D-2 / D-3 渐进上。
