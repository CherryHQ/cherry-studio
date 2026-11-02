# Agent Note: 移除仅供测试使用的 ArtifactPane 包装层

Status: proposed

[English](2026-10-31-artifact-pane-test-only-wrapper.md) | 中文

## 问题

`ArtifactPane.tsx` 的默认导出没有被任何生产代码引用。唯一的引用方是 `ArtifactPane.test.tsx`，有 36 处渲染。生产环境由 `AgentRightPane` 直接渲染 `ArtifactPaneView`，传 `headerVariant="pane"`，不传 `maximized`。

这个包装层是第二个状态所有者。它有四组受控或内部状态，还有自己的工作区重置和失效选中清理。`AgentRightPane` 另外实现了同样的行为（`workspaceKey` 重置和 `isSelectableFileNode` 检查）。这带来两项代价：

- 这 36 处测试渲染的 `ArtifactPaneView` 是真实组件，但它们运行的重置和清理代码用户永远不会执行，所以生产路径的这部分行为出错时它们仍可能通过。
- `ArtifactPaneView` 保留了一个生产上不会显示的 overlay 头部分支，以及生产上不会设置的 `maximized` 样式。

## 方案

删除默认导出和 `ArtifactPaneProps`。让 pane 头部成为 `ArtifactPaneView` 唯一的形态：移除 `headerVariant`，移除 `searchToolbar`、头部和 `renderOverlay` 中的 overlay 分支，以及 `maximized` prop 和对应样式。

测试一次性迁移。生产代码负责的行为在其所有者处测试：工作区重置和失效选中放在 `AgentRightPane.test.tsx`，渲染放在 `ArtifactPaneView`。测试文件里用一个小型辅助组件提供 model 和选中状态，让 pane 测试保持简短。只验证已删除的 overlay 头部或包装层自身状态的测试直接移除，并在 PR 中逐条列出。

这项工作一个 PR 就能完成，不需要栈式 PR，因为没有其他代码依赖被移除的部分。

## 考虑过的替代方案

- 保留包装层作为测试夹具：否决。这样会保留第二个状态所有者，测试也继续脱离生产行为。
- 把包装层原样移到测试辅助文件：否决，理由相同，尽管这是改动最小的做法。
- 让 `AgentRightPane` 改用包装层：否决。它需要 `AgentRightPane` 持有的共享状态、会话和文件导航，状态会往错误的方向移动。

## 验收标准

- AC1 — `ArtifactPane.tsx` 没有默认导出和 `ArtifactPaneProps`，`ArtifactPaneView` 没有 `headerVariant` 和 `maximized` prop。（验证：单元测试）
- AC2 — 工作区重置和失效选中清理通过 `AgentRightPane` 测试，移除相应生产行为时这些测试会失败。（验证：渲染层测试）
- AC3 — 每个被移除的测试都在 PR 中列出，并写明替代它的生产测试，或说明它只覆盖了已删除的代码。（验证：渲染层测试）
- AC4 — 智能体右侧面板中的文件树、预览、编辑、冲突处理、标签页和搜索行为不变。（验证：Electron）

## 风险

- 部分包装层测试可能是某项生产行为的唯一覆盖。AC3 用来确保覆盖被迁移，而不是消失。
- `proposed/architecture` 中的文件编辑 Spec 把 `ArtifactPane` 列为使用方。正在进行的实现可能改动同一文件，开工前要检查开放的 PR。
