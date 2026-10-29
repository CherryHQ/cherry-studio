# Agent Note: 停用本地 Agent 时归档其对话

Status: implemented

[English](2026-10-29-local-agent-disable-archive.md) | 中文

## Problem

关闭本地 Agent 原先只会将其从选择列表中隐藏，对话仍保持活跃，也没有经过已有的 Agent 归档生命周期。如果归档后管理器无法读取原记录，自定义 Agent 还会从管理器中消失，内置预设重新启用时也可能覆盖原配置。

## Decision

管理器在调用现有 Agent 归档命令前要求用户确认，并同时归档关联对话。取消或归档失败时，Agent 保持启用。确认文案说明归档和 WebUI 停止，并根据现有归档检查的要求提醒用户先停止运行中的任务。

管理器同时读取已归档的本地 Agent。原配置保存在同一条记录中，归档期间仅供查看。界面的禁用状态来自归档状态，停用不会覆盖保存的运行时配置。重新启用时先检查该配置，再调用现有 Agent 恢复命令，保留 ID、排序、配置及本次一起归档的对话。单独归档过的对话保持归档。

归档提交后的刷新失败只记录日志，不阻止尝试停止 WebUI。WebUI 停止失败时显示错误，已经完成的归档不会撤销。不新增数据表或另一套归档存储。

## Alternatives considered

- 继续只修改启用标记：对话没有经过用户要求的归档生命周期。
- 清空配置或重新启用时创建替代 Agent：会丢失配置或历史身份。
- 修改设置时隐式恢复已归档 Agent：会让编辑操作在没有启用动作的情况下改变归档状态。

## Consequences

已归档的配置可以查看，修改前需要重新启用。现有归档的运行中会话检查及保留期限规则继续生效。数据永久移除后，管理器无法恢复原数据。

## Verification

- Regression — `LocalAgentDirectory.test.tsx`、`LocalAgentDirectoryCli.test.tsx` 和 `CodeCliPage.test.tsx`：55 项测试通过，包含取消、归档失败、恢复时保留配置、恢复失败、WebUI 停止失败，以及重新打开已归档的自定义 Agent 时不弹出新建抽屉。
- Regression — `AgentLifecycleService.workspace.test.ts`、`AgentLifecycleService.recovery.test.ts` 和 `LocalAgent.test.ts`：45 项测试通过，1 项平台用例跳过；现有生命周期恢复同批归档的对话和工作目录，单独归档的对话保持归档。
- Regression — 使用临时自定义 ACP Agent 的真实 Electron 验收：取消时 Agent 保持活跃；归档包含其活跃对话；重新打开时保留配置；启用时保留 ID、排序及配置，恢复同批归档的对话，单独归档的对话保持归档。验收后已移除测试记录。
