# Agent Note: 移除仅供测试使用的 ArtifactPane 包装层

Status: implemented

[English](2026-10-31-artifact-pane-test-only-wrapper.md) | 中文

## 问题

`ArtifactPane.tsx` 曾有一个没有被任何生产代码引用的默认导出。唯一的引用方是 `ArtifactPane.test.tsx`，有 36 处渲染。生产环境由 `AgentRightPane` 直接渲染 `ArtifactPaneView`，传 `headerVariant="pane"`，不传 `maximized`。

这个包装层是第二个状态所有者。它有四组受控或内部状态，还有自己的工作区重置和失效选中清理，而 `AgentRightPane` 另外实现了同样的行为。这些测试点可能在生产行为已损坏时仍然通过。`ArtifactPaneView` 还保留了生产环境走不到的 overlay 头部分支和 `maximized` 样式。

## 决策

`ArtifactPane.tsx` 只导出 `ArtifactPaneView` 及其路径和大小辅助项。pane 头部是唯一形态：`paneTitle`、`paneActions`、`fileTabs` 和 `onPreviewClose` 为必填，文件搜索始终开启，`headerVariant`、`maximized`、`enableFileSearch`、overlay 关闭按钮、overlay 标题和未保存圆点、`FileTree` 的 `searchToolbar` 属性都已移除。打开的文件始终由标签页和面包屑显示标题。

`AgentRightPane` 是工作区重置和失效选中清理的唯一所有者，`AgentRightPane.test.tsx` 测试这两项行为。判定选中是否失效的依据由 `useArtifactFileTreeModel` 负责，因此监听器删除和搜索保留的测试直接断言模型。`ArtifactPaneView` 的渲染测试共用 `ArtifactPane.test.tsx` 中的 `ArtifactPaneHarness`，它按 `AgentRightPane` 传参的形态提供文件树模型、选中状态、标签页和关闭处理，不带任何重置或清理逻辑。

## 备选方案

- 把包装层保留为测试夹具：已否决。它保留了第二个状态所有者，测试仍然脱离生产行为。
- 把包装层原样移入测试辅助文件：同样否决，尽管这是改动最小的做法。
- 让 `AgentRightPane` 改用包装层：已否决。包装层需要 `AgentRightPane` 持有的共享状态、会话和文件导航，状态的流向反了。

## 影响

用户无感知。`ArtifactPane.tsx` 缩短约 220 行，`ArtifactPaneView` 只有一种头部形态。`ArtifactPane.test.tsx` 不再证明面板会关闭已删除的文件：这一结果由模型测试和 mock 了模型的 `AgentRightPane` 清理测试分段覆盖。

## 验证

- AC1 — `git grep -n headerVariant -- src` 无结果，且限定在八个改动文件的类型检查通过：默认导出、`ArtifactPaneProps`、`headerVariant` 和 `maximized` 均已移除。
- AC2 — `pnpm test:renderer src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentRightPane.test.tsx`：`clears open files, edit mode, and tree filters when the workspace $changed changes` 和 `clears the overlay preview when the selected file disappears from the tree model` 通过，且删除六条重置语句中的任一条或清理 effect 时都会失败。
- AC3 — 实现 PR 列出全部八个被移除或替换的测试，并写明替代测试或其只覆盖已删除代码的原因。
- AC4 — 通过 CDP 驱动 Electron 开发构建：文件树、预览、编辑切换、自动保存、冲突的重新加载与保留草稿、标签切换与关闭、Escape、搜索、删除已打开文件、分栏与取消固定布局、工作区切换均符合 Spec，运行期间渲染进程没有重新加载。
