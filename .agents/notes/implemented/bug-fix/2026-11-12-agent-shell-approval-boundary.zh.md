# Agent Note：无人值守的 shell 或代码模式调用必须先确认

Status: implemented

[English](2026-11-12-agent-shell-approval-boundary.md) | 中文

## Problem

Agent 会话把用户配置的 OpenAI 兼容端点的响应当作可信指令来源。在 `auto` 下，`bash` 调用唯一的闸门是一份删除类命令的模式名单，因此端点只要返回 `tool_calls: bash`，就能让任意命令在宿主机上无提示执行。`codemode`（在 worker 里通过 `new Function` 执行代码）的 `permissionClass` 是 `meta`，而闸门对所有 meta 调用直接短路放行，所以它在每种权限模式下都会无提示运行，`default` 也不例外。

在打包的 2.1.10 上复现：端点收到九个工具定义，其中包含 `bash` 与 `codemode`；一次 `bash` 调用全程没有审批界面，并把 `id` 的输出写到了宿主机文件里。

## Decision

把代码执行视为绝不无人值守的能力，同时不改变 `auto` 的用途。

两处改动都在共享审批闸门内：

- 闸门的 shell 分支改为按 `category` 判定，而不是匹配 `bash`/`powershell` 这两个工具名字符串；`ToolCategory` 新增 `shell`，shell 类工具不再依赖名字匹配。
- `auto` 下 shell 调用会询问，直到用户在本会话内为该工具授权一次。删除类命令仍然每次都问，授权永不覆盖它。授权状态保存在 `createPiInteractionPorts`，Pi 与 Pi Durable 共用这一处。
- `codemode` 归为 `shell` 类并进入强制确认集合，因此在所有交互模式下都会询问。它的提示由输入区承载：待审批扫描原先要求 `state === 'approval-requested'`，但 provider 执行的 dynamic tool 部件会停在 `input-available` 却已带上 `approval.id`，于是整轮卡死且没有提示。现在扫描把「尚未决的审批」也视为待审批。

明确的边界：这是"同意"的边界，不是"执行"的边界。它不沙箱化命令，也不把删除名单提升为权威判定。

## Alternatives considered

- 把 shell 规则反转为只读命令白名单：否决。`auto` 的用途就是去掉例行询问，而白名单会让 `ls`、`cat`、`grep` 都变成确认。
- 对自定义端点不下发 `bash`/`codemode`：否决，过于生硬——能力消失且没有回退路径，而且要做到真正的边界还需要入站校验。
- OS 沙箱（Seatbelt/bwrap）与可信侧分类器：暂缓。由同一端点提供判定的分类器毫无价值，沙箱则是更大的改动。
- 仅扩充删除命令模式名单：否决作为主要修复，因为它让报告中的验证用例（`id > file`）依然无提示执行。

## Consequences

- `auto` 对读取、允许根内的编辑，以及首次授权之后的非删除类 shell 命令，保持低摩擦。
- 需要 shell 或 `codemode` 的无人值守轮次现在会被阻断，而不是直接执行。依赖无人值守 shell 调用的定时任务会失败；是否提供会话级例外是后续的产品决策。
- `codemode` 在 `default` 与 `auto` 下都会询问；在 `bypassPermissions` 下仍然放行，除非同时标记为不可绕过。
- 残余风险不变且很大：端点仍能促成用户批准的任何命令，已授权的会话在结束前会持续执行命令。权限模式的说明文字仍把 `auto` 描述为能识别风险，收紧该文案是另一项改动。
- 授权按连接保存，因此会话恢复后会再问一次。

## Verification

- Regression — `packages/agent-behavior/tests/core/approval/approval.test.ts`：shell 分类驱动 `auto` 判定，会话内首次未授权的 shell 调用会询问，已授权的会话放行，删除类命令无视授权仍然询问，`codemode` 在所有交互模式下询问且无人可答时阻断。
- Regression — `src/main/ai/runtime/pi/piApprovalFacts.test.ts`：`auto` 下首条 shell 调用产生审批请求、批准后放行，同工作区内的写入仍然无需询问，而 `codemode` 会产生审批请求而非作为豁免的 meta 工具直接运行。
- Regression — `src/renderer/components/composer/variants/__tests__/permissionRequestComposerRequest.test.ts`：dynamic tool 部件上未决的审批被视为待审批，已决的不再提示，显式等待审批的部件仍然能被找到。
- Regression — `pnpm typecheck`：新增的必填 `sessionGranted` 事实下所有工程均通过类型检查。
- Manual — 打包的 Cherry Studio 2.1.10：改动前本地模拟端点的 `bash` 调用无任何提示即执行；该复现正是本笔记要修复的问题。
- Manual — 改动后的 dev 构建：同一端点的首条 `bash` 调用弹出审批卡、未生成取证文件，只有批准后才执行。
- Manual — dev 构建的 `codemode`：闸门下发了调用后整轮卡死、没有任何审批控件，这正是本次渲染层扫描修正要解决的问题；修正后尚未做真机复测。
