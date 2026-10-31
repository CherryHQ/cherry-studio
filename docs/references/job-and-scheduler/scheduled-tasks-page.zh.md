---
description: 定时任务页面的导航、关联对话选择、分页和升级行为
sources:
  - src/renderer/pages/agents/ScheduledTasksPage.tsx
  - src/renderer/pages/agents/AgentChat.tsx
  - src/renderer/pages/agents/components/ScheduledTaskSidebar.tsx
  - src/renderer/components/app/sidebarIcons.tsx
  - src/renderer/hooks/agent/useTaskConversation.ts
  - src/renderer/services/taskConversation.ts
  - src/main/data/services/AgentTaskService.ts
  - src/main/data/db/seeding/seeders/scheduledTasksShortcutSeeder.ts
---

# 定时任务页面

[English](scheduled-tasks-page.md) | 中文

## 使用页面

从全局侧边栏打开“定时任务”。选择“活跃”或“已暂停”中的任务，查看并继续关联对话。两组分别维护分页、总数、加载状态和重试操作。已完成和已错过的任务仍可在设置页查看。

“添加定时任务”在当前窗口打开共享创建表单。创建成功后选中返回的任务，不额外发送立即执行命令。尚未执行的任务显示等待状态。暂停影响后续调度，不取消已经开始的执行。

每组可独立折叠，不改变已打开的对话。任务右侧三点菜单提供继续或暂停、立即执行、编辑和删除。删除显示为红色，需确认后执行。编辑打开共享表单并带入当前任务内容。删除选中任务会清除路由选择；删除其他任务不改变当前对话。

## 侧栏与对话顶栏

侧栏沿用智能体页面的背景、间距和列表交互。背景使用共享语义色：默认浅色主题下为白色，其他模式随主题变化。全局入口选中后使用填充日历，并以反色显示时钟细节。

任务行先显示名称，下方显示所属智能体和执行频率。小字按内容分配可用宽度，不强制各占一半。过长内容保持单行并显示省略号，悬停可查看完整值。任务正文与三点按钮共用悬停和选中背景。操作按钮在悬停或键盘焦点时显示，触屏保持可见。

右侧顶栏显示任务名称、运行摘要、执行记录选择器及适用的历史操作，仅在本页替代智能体、模型和工作目录控件。消息发送者信息及对话输入框保持原样。选择任务或折叠分组不会启动执行。

## 选择关联对话

- 路由保存 `taskId` 和可选的 `runId`。URL 中的 `sessionId` 不能证明会话归属。
- 明确选择的执行必须属于当前任务。对应对话缺失或已删除时，不替换为其他执行。
- 其他情况下，有效的绑定复用会话优先于最近可用的执行对话。
- 自动查找最多读取两页日志，每页 50 条。继续查找每次追加一页。达到自动预算不代表历史已经查尽。
- 新执行提供主动切换入口，不替换正在阅读或编辑的对话。切换任务会使之前的查找失效。
- 消息、工具、审批和忙碌保护复用现有智能体对话运行时。离开页面不会停止调度。

## 读取与命令边界

`GET /agent-tasks` 接受可选的 `status`：`active`、`paused`、`completed` 或 `missed`。省略时保留原有未筛选列表。服务先派生并筛选状态，再计算总数和截取当页；主进程仍会扫描候选计划。

本页面每组最多返回 50 个任务。仅选中任务加载执行历史和对话消息。日志分页使用现有任务服务的 SQL limit、offset 和 count。运行摘要和智能体名称批量读取；页面不新增轮询计时器。

创建、暂停、恢复、主动执行、编辑和删除使用现有的 `ai.agent.task.*` 命令。打开菜单不执行命令。发送对话消息不会修改任务提示词或计划。

## 快捷方式升级

新安装默认提供 `core.app` 快捷方式。带版本记录的 seeder 向现有 `ui.sidebar_shortcut` 列表补入一次。存在对话和智能体入口时，插入其后，不改变原项目的相对顺序。已有定时任务入口保持原位。用户在此次升级后移除入口，重启不会补回。

[Spec](../../../.agents/notes/proposed/feature/2026-10-31-scheduled-tasks-page.md) 维护设计理由和验收标准。
