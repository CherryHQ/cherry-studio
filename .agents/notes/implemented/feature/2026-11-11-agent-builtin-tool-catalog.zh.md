# Agent Note: 每个运行时统一的内置工具目录

Status: implemented

[English](2026-11-11-agent-builtin-tool-catalog.md) | 中文

## Problem

智能体的「内置工具」列表过去是按运行时手写的数组，因此 Pi 和 Pi Durable 一直没有提供它们本就能执行的 Cherry MCP 工具（`src/shared/ai/agentRuntimeCapabilities.ts:26`、`:135`；`src/shared/ai/builtinMcpToolName.ts:5`）。同一份列表用三种方式表达「不可用」：只有 Claude 的 ID 检查会把知识库行整个隐藏，浏览器和计算机行显示为带徽章的不可用，而没有配置绘图模型时 Generate Image 仍显示为开启（`src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx:1156`、`:1175`、`:1231`、`:1256`）。

Knowledge Search 在注册表里声明了列表与文档读取两个依赖（`src/shared/ai/claudecode/toolRegistry.ts:286`、`:297`、`:309`），Claude Code 会展开该依赖，而 Pi 从不展开，所以关闭 Knowledge Search 后 `kb_list` 和 `kb_read` 仍可调用。

## Decision

一个运行时的目录由两部分组成：它支持的原生描述符，加上所有声明了 `exposure === 'user'` 且带 `mcpServer` 的规范定义。因此可见性跟随定义，而不跟随审批注册表：注册一条策略不代表工具应公开，内部工具（session、doctor、assistant、`kb_list`、`kb_read`）也不会变成目录行。

每一行保存的是该运行时自己认可的标识，一个开关因此能作用到真正负责拦截的机制：Claude Code 用 `mcp__cherry-tools__*`（`disallowedTools`），Pi 和 Pi Durable 用 `mcp__cherry_tools__*`（`excludeTools`、`tools.remove`）。标识函数放在共享层且可在渲染进程使用；不需要修改智能体 schema、保存 ID 映射或新增偏好设置。

前置条件在规范定义上声明一次——知识库范围声明在知识库工具上，绘图模型声明在 Generate Image 上——由对话框统一消费。前置条件不满足时，该行保持可见、未选中并显示既有徽章；可用性变化从不写入 `disabledTools`，因此重新绑定时会恢复用户已保存的选择。浏览器和计算机保留各自的分组可用性控件。

Pi 和 Pi Durable 在运行时生效的禁用集合中展开声明的 MCP 依赖，初始构建与 reconcile 都做，且不改写已保存的禁用项：关闭 Knowledge Search 同时阻止 `kb_list` 和 `kb_read`，而 Manage Knowledge 仍独立控制。结果适配器改为从原生描述符派生 Pi 的原生集合，而不是从 UI 目录派生，因此进入目录的 MCP ID 保持 MCP 分类，图片结果仍按图片渲染。

## Alternatives considered

- 为每个运行时手写十个 MCP 行：重复列表必然漂移，而这次缺陷正来自这种漂移。
- 从审批策略注册表推导可见性：审批注册不是可见性契约，且其中有 45 条包含内部工具。
- 扩大 `PI_BUILTIN_TOOLS` 或 `PiBuiltinToolCategory`：MCP 行不是 Pi 原生工具，而该数组还用于分类原生权限能力。
- 保存 Claude ID 并在调用时转换：保存的 ID 就不再是运行时真正排除的标识，且 Pi 对不同服务器名有自己的别名规则。
- 隐藏不可用的行：用户既看不到能力存在，也不知道为何不可用，重新绑定后已保存的禁用选择还会静默生效。
- 推迟知识库依赖：在文档读取仍可调用时上线 Knowledge Search 开关，会让新控件具有误导性。

## Consequences

目录行现在携带前置条件元数据，因此某个运行时新增公开 MCP 定义时无需改动对话框就会得到一行——而忘记声明前置条件的定义会被读成可用。已保存的禁用项仍是每个工具一个运行时原生 ID；在运行时之间切换智能体时各自保留自己的 ID，不做互相转换。

Pi 的生效禁用集合按设计比保存的数组更大：只关闭 Knowledge Search 的用户，其 `kb_list` 与 `kb_read` 在发现阶段和调用阶段都被阻止，而这个展开在每次 reconcile 时重新计算，不写入存储。

已连接的会话继续使用建立连接时捕获的绘图模型，因此模型变化会立刻反映到行的可用性上，但不会作用于既有连接。Pi 的 MCP 工具通过 codemode 暴露，因此未出现在模型的即时工具声明中本身并不证明它被排除。

## Verification

- AC1 — `src/shared/ai/__tests__/agentRuntimeCapabilities.test.ts` 为 `claude-code`、`pi`、`pi-durable` 各自投影出十个公开 MCP 行并与其原生工具共存，`kb_read` 等内部工具不出现，且保留仅 Windows 的 PowerShell 与 Durable 不提供 `vcc_recall` 的过滤。
- AC2 — `EditDialogs.test.tsx` 对 Pi 与 Claude 关闭 Generate Image、保存、从保存状态重新打开并重新启用，断言确切的运行时原生 ID，且无关限制在两个方向上都保留。
- AC3 — `PiRuntimeConnection.test.ts` 与 `PiDurableRuntimeConnection.test.ts` 使用真实链接的 MCP 夹具：关闭 Knowledge Search 后 `kb_search`、`kb_list`、`kb_read` 均不可用且调用被拒，而启用的 `kb_manage` 控件仍能执行，且已保存的 `disabledTools` 数组不变；`piDisabledTools.test.ts` 用生产命名函数钉住依赖映射。
- AC4 — `EditDialogs.test.tsx` 在被删除的绘图模型和未绑定知识库两种情况下，都渲染为可见、未选中且禁用、不触发保存的行，并在解绑与重新绑定后恢复已保存的 Knowledge Search 选择。
- AC5 — `toolResponse.test.ts` 把字面的、经 sanitize 的 MCP 图片 ID 归类为 `mcp` 并保留其图片内容，同时保留既有的原生 provider 与元工具反例。
- AC6 — `builtinToolPolicy.test.ts`、`settingsBuilder.test.ts`、`toolConditions.test.ts` 继续通过，覆盖审批与策略面、Claude 的 MCP 限制以及本次未改动的 Claude 依赖展开。
- AC7 — `verify-agent-note-format`、`verify-translation-pairing`、`check-doc-links`、`verify-doc-structure`、`verify-doc-frontmatter`、`gen-doc-index --check`、`gen-doc-terminology --check` 均通过，且 `docs/dev/references/ai/adding-a-runtime.md` 已描述目录组成与标识规则。

当前 head 的定向运行：main 通过 256 条 / 跳过 2 条（6 个文件），renderer 通过 133 条（3 个文件），shared 通过 16 条（2 个文件），所有改动文件的 `oxlint`、`eslint`、`oxfmt` 均无问题。此处不建立打包后的 Electron 验证与真实服务商出图；上述用例断言的是对话框状态与运行时排除，不是一次真实的出图往返。
