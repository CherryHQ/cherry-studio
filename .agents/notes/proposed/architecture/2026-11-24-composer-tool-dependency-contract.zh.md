# Agent Note: Composer 工具依赖契约

Status: proposed

[English](2026-11-24-composer-tool-dependency-contract.md) | 中文

## Problem

`defineTool` 将每个工具的依赖元组与其回调关联，但异构注册表擦除了这些元组。`ComposerToolRuntime` 随后构造字段子集，却断言它包含全部状态和动作键。在擦除后调用泛型 helper 无法恢复这种关联。模型断言也掩盖了合法的无模型 reconciliation。

当前可读键分类器把内部 `toolsRegistry` 和 `triggers` 对象纳入 `ToolStateMap`，但 provider 状态并不包含它们。现有内置工具没有请求这些键，其依赖声明是完整的。

## Proposal

从实际 provider 所有者派生公开状态和动作，排除展开状态及注册表内部接口。依赖元组默认为空；非空元组必须提供对应声明。

在 `defineTool` 仍保留各自元组时，通过闭包绑定依赖投影与 contribution 调用。使用现有库的 `pick` 保留声明值及其引用。注册表存储公共元数据和预备好的 runtime/reconciliation 入口。在此依赖注入桥内，只有内部 source 包含完整 provider 状态和动作；每个 contribution 只接收声明的子集。既有 provider hooks 和导出保留其完整接口。

一起准备菜单和 runtime，使其共用一个 context。通过 `createElement` 渲染原 React 组件，保留组件身份和 hooks。保留 launcher 缓存、声明依赖的 memo 比较和注册清理。Host 保持 scope → condition → 模型资格的选择顺序；condition 可以收到缺省的 model。Reconciliation 保持稳定回调、读取最新 source，且仅按 scope 选择工具；它不使用 Host 的 condition/model 挂载门禁。Assistant、model 和 session 保持真实可选。

本方案保留[令牌恢复](../../implemented/bug-fix/2026-11-03-composer-token-restore.md)和[延迟意图重放](../../implemented/bug-fix/2026-11-07-composer-deferred-intent-replay.md)的既有决策，不取代任一 Note。不提议修改工具栏、权限、剪贴板或令牌 wire 格式。

## Alternatives considered

- 在注册表擦除后增加泛型 helper：调用方仍传入已擦除元组，并错误承诺完整 context。
- 将全部 context 字段改为可选，或暴露完整 provider：前者丢失必需依赖的类型，后者削弱声明子集隔离并暴露内部接口。
- 保留完整 context 断言并增加注释：错误的状态键分类器和无法证明的注册表关联仍然存在。

## Acceptance criteria

- AC1 — 类型化工具保留精确的声明状态和动作字段；renderer 类型检查契约拒绝未声明或内部字段、遗漏的非空依赖声明，以及未经准备的注册表定义。 (verification: renderer; owner: Composer runtime)
- AC2 — 异构工具接收各自声明的值和原始引用；同一工具的菜单和 runtime 共用投影 context，不暴露完整 provider。 (verification: renderer; owner: Composer runtime)
- AC3 — Runtime 挂载保留 scope、condition 和模型资格行为，原样传递缺省的 Assistant/model 及 Session 数据，不制造占位对象。 (verification: renderer; owner: Composer runtime)
- AC4 — 附件和知识库 reconciliation 读取当前 provider 状态，在无模型时仍可工作，并忽略 condition/model 挂载门禁，同时保留 scope 可见性。 (verification: renderer; owner: Composer runtime)
- AC5 — Launcher 更新和清理保留注册所有权，已挂载 runtime 的 hook 状态在依赖更新后仍保留，且无关状态不会导致重新挂载。 (verification: renderer; owner: Composer runtime)

## Risks

原始测试定义必须使用工厂，才能覆盖同一注册契约。新闭包不能在每次更新时创建新的 React 组件类型，也不能把带 hooks 的组件作为普通函数调用。直接展开完整 source，或让 Host 与 reconciliation 共用筛选逻辑，都会改变既有行为。

类型契约和 renderer 回归由当前迁移流程中的远程 CI 验证。本 proposed Note 不声称已执行测试、CI 已成功、已完成真实 Electron 交互检查，或更广泛的断言迁移已经完成。
