# Agent Note: 首条消息之后在 Agent 顶栏保留工作区身份

Status: implemented

[English](2026-11-11-agent-top-bar-workspace-identity.md) | 中文

## Problem

2.2.0 把 Agent 会话信息迁入紧凑的详情卡片（见[紧凑的 Agent 会话详情卡片](../feature/2026-11-08-agent-session-details-card.md)），并随之让顶栏只在会话是符合条件的空会话时才挂载工作区控件：`AgentTopBarControls` 传入 `showWorkspace={!!onWorkspaceChange}`，而 `AgentConversationControls` 在该值为 `false` 时整块跳过控件。

首条消息之后工作区本就不允许修改 —— 这是既定行为，由 `PUT /agent-sessions/:sessionId/workspace` 强制 —— 但**身份信息**也随之消失。有一条消息的会话不再显示文件夹图标、工作区名称和打开目录的操作，而 2.2.0 之前同一个会话会渲染同一控件的只读分支：文件夹图标与工作区名称包在指向 `workspace.path` 的 `OpenTargetButton` 里。用户把这种丢失表述为「升级后我的工作目录没了」，而丢失取决于消息是否存在，与 Agent 的创建时间或已存配置无关。见 [issue #24211](https://github.com/CherryHQ/cherry-studio/issues/24211)。

## Decision

把工作区控件的**可见性**与**可编辑性**分开。顶栏始终挂载 `WorkspaceControl`；只有选择与清除操作继续受「符合条件的空会话」约束，判据是是否传入 `onWorkspaceChange`。

`isEmptyConversation` 与 `canChangeWorkspace` 保持不变：必须存在会话、消息历史已启用、没有进行中的加载/等待/更早分页，且消息数为零，才会把 `handleSessionWorkspaceChange` 传下去。未传入时 `WorkspaceControl` 走既有的只读分支 —— 文件夹图标、工作区名称，以及用户工作区的打开目录操作 —— 系统工作区仍显示既有的「未设置工作目录」标签，且不出现用户文件夹打开器。选择打开目录的应用不会重新绑定会话工作区，因此继续可用。

服务端仍是「存在非根消息即禁止重绑」的权威；不引入「曾经发送过」标记、配置回退、迁移或工作区重分类。

## Alternatives considered

- 告诉报告人工作区身份现在由会话详情负责、不做改动：详情卡片确实能显示并打开目录，但它让一个原本一眼可见的工作目录变成必须先展开卡片，而报告中的验收点明确的正是顶栏。
- 有消息之后仍渲染完整的可编辑选择器：与写入锁冲突，并会诱发一次必然被拒的修改。
- 常驻显示完整路径为第二行：属于另一项展示改动；该控件的身份是工作区名称加打开目标。
- 会话工作区是系统工作区时读旧的 `agent.configuration.workspacePath`：`agent_session.workspace_id` 是唯一事实来源，该键没有读取方，按配置猜测目录会打开错误的路径。

## Consequences

已锁定的会话保留文件夹图标、工作区名称和可用的打开目录操作；清除或切换工作区仍只允许在空会话中进行，发送第一条消息现在只移除这两种操作。系统工作区仍显示「未设置工作目录」，也不会获得打开器。详情卡片继续提供完整路径及其自身操作，两个界面由此互相一致，而不是一个取代另一个。

## Verification

- Regression — `src/renderer/components/composer/variants/agent/__tests__/AgentConversationControls.test.tsx` 在不传 `onWorkspaceChange` 的情况下渲染真实控件，断言文件夹图标与名称、针对 `workspace.path` 的 `external_app.target.open` 载荷，以及不存在选择/清除操作；系统工作区用例断言「未设置工作目录」标签、禁用状态且没有打开器。
- Regression — `src/renderer/pages/agents/__tests__/AgentChatWorkspaceIdentity.test.tsx` 渲染 Agent 会话，断言有消息之后顶栏仍保留工作区身份，而空会话仍提供选择器。
- Regression — `src/main/data/services/__tests__/AgentSessionService.test.ts` 保留既有用例，仍然拒绝有消息之后 user→user、system→user、user→system 的工作区切换。
- Regression — 一次 Electron 冒烟运行，对用户工作区、已有消息的会话顶栏在改动前后各截一张图。
