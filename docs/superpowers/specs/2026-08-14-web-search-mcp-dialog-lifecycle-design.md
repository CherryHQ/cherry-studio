# Web Search API Key 与 MCP 导入弹窗生命周期修复设计

## 状态

- 设计范围已于 2026-08-14 经用户确认。
- 本文档用于实现前复核；实现计划在本文档确认后另行编写。

## 问题

在 Web Search 设置页打开 Tavily API Key 管理弹窗后，如果应用收到魔搭发起的
`cherrystudio://mcp/install` 深链，主进程会导航到 MCP 服务器页并打开 MCP 安装确认弹窗。此时页面上同时存在两个由不同宿主管理的模态框：

- Tavily API Key 弹窗由全局 `PopupHost` 管理，离开 Web Search 路由后仍然存在。
- MCP 安装弹窗由 MCP 页面本地状态管理，进入 MCP 路由后立即挂载。

两个弹窗使用相同层级的 Radix Dialog overlay/content。MCP 弹窗成为无障碍意义上的活动模态框，但仍在前方的 Tavily overlay 会拦截鼠标事件，导致两个弹窗的按钮都无法点击。渲染线程仍然响应，因此这是模态框所有权与层级冲突，而不是进程或事件循环卡死。

## 目标

1. Web Search API Key 管理弹窗的生命周期跟随其设置页消费者。
2. MCP 深链导航发生后，旧的 API Key 弹窗必须同步卸载，只保留 MCP 安装弹窗。
3. 保持现有“先保存行内 API Key 草稿，再打开 Key 列表”的行为。
4. 用最小自动化回归覆盖“旧路由弹窗已打开时进入 MCP 安装页”的用户结果，并在隔离 Electron 实例中验证真实深链交互。

## 非目标

- 不修改 MCP 深链解析、请求队列或导航协议。
- 不修改共享 Dialog 的 `z-index`、Radix 行为或全局 `PopupHost`。
- 不引入全局模态框协调器。
- 不顺带迁移 File Processing 等其他 `createPopup` 消费者；它们需按各自路由与调用场景另行评估。
- 不改变 API Key 的持久化格式、校验规则或列表编辑语义。

## 现有实现与根因

`WebSearchApiKeyList.tsx` 通过 `createPopup` 导出 `WebSearchApiKeyListPopup`。调用
`WebSearchApiKeyListPopup.show()` 后，弹窗条目由窗口根部的 `PopupHost` 持有，与发起调用的 `WebSearchProviderSetting` 生命周期无关。

MCP 协议处理则是另一条独立链路：

1. `ProtocolService` 解析并暂存安装请求。
2. 主窗口导航至 `/settings/mcp/servers?protocolInstallRequestId=...`。
3. `McpServersList` 根据请求渲染本地 `McpProtocolInstallDialog`。

路由切换只会卸载 Web Search 页面，不会清理全局 popup 条目。于是旧 popup 与新路由的本地 Dialog 并存，形成已复现的双 overlay 冲突。

## 仓库内可比做法

Provider 设置页的 `ConnectionSettings/ApiKey.tsx` 已采用消费者持有的受控状态：父组件维护 `keyListOpen`，并把 `open` 与关闭回调传给 `ProviderApiKeyListDrawer`。该模式让 UI 的所有权与页面生命周期保持一致，适用于本问题。

本修复沿用这一模式，不扩展全局 popup 基础设施。

## 设计

### 1. 将 Web Search Key 列表改为受控 Dialog

在 `WebSearchApiKeyList.tsx` 中保留现有 `WebSearchApiKeyList` 内容组件，并以受控组件替代 `WebSearchApiKeyListPopup`：

```ts
interface WebSearchApiKeyListDialogProps {
  providerId: WebSearchProviderId
  title?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}
```

新组件继续使用现有 `Dialog`、`DialogContent`、标题和列表内容，且继续禁止点击 overlay 关闭。关闭按钮与 Escape 通过 `onOpenChange(false)` 交还父组件处理。

`WebSearchApiKeyList.tsx` 不再导入 `createPopup` 或 `PopupInjectedProps`，也不再注册全局 popup 条目。

### 2. 由 Web Search 消费者持有打开状态

`WebSearchProviderSetting` 新增本地 `apiKeyListOpen` 状态，并在页面组件树内渲染受控 Key 列表 Dialog。

打开流程保持为：

1. 用户点击 Key 列表按钮。
2. 调用现有 `persist(commitApiKeysDraft, ...)` 保存行内草稿。
3. 保存成功后执行 `setApiKeyListOpen(true)`。
4. 保存失败时保持关闭，并沿用现有错误提示。

普通关闭时执行 `setApiKeyListOpen(false)`。当深链导航卸载 Web Search 路由时，Dialog 随消费者同步卸载，不需要跨路由清理或延迟动画回调。

### 3. MCP 流程保持不变

`ProtocolService`、MCP 请求队列、`McpServersList` 和 `McpProtocolInstallDialog` 均不修改。进入 MCP 路由后，页面中只有 MCP 安装 Dialog 一个活动模态框，取消和安装按钮可正常接收鼠标与键盘输入。

## 状态流

```text
Web Search 页面
  └─ 点击 Key 列表
       ├─ 草稿保存失败 → 显示现有错误，Dialog 保持关闭
       └─ 草稿保存成功 → 本地 Dialog 打开
                              │
                              ├─ 用户关闭 → 本地状态置 false
                              └─ MCP 深链导航 → Web Search 路由卸载
                                                   ↓
                                            API Key Dialog 卸载
                                                   ↓
                                         MCP 路由挂载唯一 Dialog
```

## 数据与错误处理

- 行内 API Key 草稿在打开列表前提交，行为不变。
- Key 列表内已有的新增、编辑、删除持久化逻辑不变。
- 用户尚未确认的列表输入在关闭或路由切换时丢弃；这与当前关闭弹窗的语义一致。
- 打开前保存失败时不打开 Dialog，继续由现有 `persist` 路径记录日志并提示用户。
- MCP 安装失败、取消和请求消费逻辑不在本修复范围内。

## 测试设计

### 值得保护的回归

1. 行内 API Key 保存成功后，用户能够看到并关闭真实的 Key 列表 Dialog。
2. 保存失败时 Key 列表不打开。
3. Key 列表打开后模拟路由切换到 MCP 安装页，旧 Key 列表消失、页面只剩一个可访问 Dialog，且用户可以点击 MCP 的取消按钮。

第 3 项是本缺陷的最小自动化复现：使用真实 `@cherrystudio/ui` Dialog 与用户语义查询，通过测试 harness 模拟设置路由卸载。主进程现有测试已经覆盖 MCP 深链解析、请求暂存与目标路由导航，因此不在 renderer 测试中重复模拟协议实现。

实现后还需在已隔离、持续运行的 Electron 实例中执行真实链路：打开 Tavily Key 列表，注入 ModelScope 等价的 MCP 安装深链，确认只有 MCP 弹窗保留，并分别验证鼠标取消、安装入口和 Escape 行为。

### 刻意不增加的测试

- 不为共享 Dialog 增加 `z-index` 或 pointer-events 断言，因为修复不依赖这些实现细节。
- 不重复 ProtocolService 已有的协议解析和导航单元测试。
- 不增加 File Processing popup 用例，因为该消费者不在本次确认范围。
- 不新增仅断言组件 props 或 mock 子组件存在的测试。

## 验收标准

1. Tavily API Key 管理功能在正常进入、保存和关闭场景下行为不变。
2. 打开 Tavily API Key 管理后触发 MCP 安装深链，Web Search 弹窗随路由切换消失。
3. MCP 页面仅存在一个活动 Dialog；取消和安装按钮不会被其他 overlay 拦截。
4. Escape 只关闭当前 MCP 安装 Dialog，不会重新露出遗留的 Tavily popup。
5. 打开 Key 列表前的 API Key 保存失败时，Dialog 不打开且现有错误提示保留。
6. 针对性 renderer 测试、相关 main 测试和 UI 包 Dialog 测试通过。
7. 隔离 Electron 实例中的真实交互回归通过，且无 renderer page error。

## 方案取舍

### 采用：消费者受控 Dialog

优点是改动局部、所有权明确，并由 React 路由卸载自然保证清理；它也与 Provider 设置页的既有模式一致。代价是 Web Search 的 Key 列表不再能通过全局命令式 handle 打开，但当前只有这一个页面消费者，不需要该能力。

### 不采用：提高 MCP Dialog 层级

单独提高 `z-index` 只能遮住当前冲突，旧 popup 仍然存活并可能继续影响焦点、Escape 和无障碍状态，也无法保证未来第三个 overlay 的顺序。

### 不采用：页面卸载时调用 popup `hide()`

该方案继续让页面依赖全局可变条目和退出动画时序，路由切换期间仍可能短暂并存；异常导航与重复调用也需要额外协调。

### 不采用：全局模态框协调器

统一模态框栈可以从基础设施层解决更多冲突，但会改变所有 popup/Dialog 消费者的共享契约，风险和验证范围远超本次单一消费者缺陷。
