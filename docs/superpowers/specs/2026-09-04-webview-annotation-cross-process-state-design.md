# WebView 元素标注跨进程状态设计

## 状态

已确认设计，面向尚未合并的 WebView 元素标注 PR。本文定义产品语义、状态所有权、跨进程协议、生命周期、安全边界和验证标准；不包含实现步骤。

## 背景

当前实现把同一份 annotations 同时放在 Guest preload、Renderer 和 Main：Guest 持有 DOM 引用和交互状态，Renderer 镜像完整列表并在每次变化时同步，Main 又把快照写入 Cache。复制时 Renderer 先覆盖 Main 快照，再请求 Main 读取该快照、补充 accessibility 信息并格式化 Markdown。

这种增量式链路产生了三个根因问题：

1. 没有唯一事实源，导航、WebView 替换、异步复制和组件卸载都需要额外 revision、清理和补偿同步。
2. 临时文档状态被建模成跨进程 Cache，扩大了生命周期和一致性问题，却没有真实的跨窗口消费需求。
3. UI、Guest DOM 交互、WebContents 生命周期、CDP accessibility 和格式化同时堆进少数大文件，导致安全、竞态和清理缺陷彼此放大。

本设计从产品生命周期重新确定所有权，而不是继续修补现有双写协议。

## 目标

1. 每个当前文档只有一个 annotations 事实源。
2. Renderer 只持有渲染 UI 所需的摘要，不镜像业务内容。
3. Main 只保留权限校验和 WebContents 生命周期所需的会话状态，不缓存 annotations。
4. 复制使用一次请求对应的一次新鲜 snapshot，任何过期结果都不能写入剪贴板。
5. 完整导航、刷新、崩溃、销毁、target 切换和宿主失活都有明确且可测试的语义。
6. 使用仓库既有 IpcApi、lifecycle 和目录约定，不新增数据系统或通用基础设施。

## 非目标

- 不持久化 annotations，不跨应用重启恢复。
- 不跨 WebView、标签、分屏或窗口聚合导出。
- 不增加导航确认框或未保存草稿提示。
- 不增加跨窗口同步、全局 Renderer store 或隐藏 UI channel。
- 不新增 DataApi、Preference、BootConfig 或 Cache key。
- 不保留旧 annotation IPC 的兼容层或双写逻辑。
- 不借此重构 WebView 的打印、保存、拼写检查、弹窗策略等无关能力。
- 不在本次状态重构中进一步拆分 Guest controller 的 DOM、selector 和 overlay 实现。

## 已确认的产品语义

### 文档范围

annotations 是当前 WebView 当前文档的临时会话数据：

- 完整主框架导航或刷新立即丢弃已提交 annotations 和未保存草稿；不拦截导航。
- 从 `did-start-navigation` 判定为新文档起即丢弃。即使导航随后失败，也不恢复旧状态。
- hash 变化、`history.pushState` 等 same-document navigation 保留 annotations。
- 关闭 WebView 或 Guest render process 丢失后不恢复 annotations。
- 复制 Markdown 是唯一导出动作。

### 当前视图导出

复制只导出用户当前操作的一个 WebView 和一个文档 session。其他已打开 WebView 的 annotations 不参与输出。

### 宿主失活

当标签、分屏或所属面板不再 active 时：

- 退出选择模式；
- 关闭并丢弃未保存编辑器草稿；
- 保留同一文档中已经提交的 annotations；
- 恢复 active 后由用户显式重新进入选择模式。

### Target 变化

同一个 WebView 被重新绑定到不同 `target.id` 时，旧操作立即失效，并清空 Guest 中属于旧 target 的 annotations。只有 label、locale 或 theme 变化时不重建文档 session，也不清空 annotations。

## 已考虑的方案

### 方案 A：Guest 是 annotations 事实源，Main 是信任根

Guest 持有完整 annotations 和 DOM identity；Renderer 只持有 `enabled`、`count` 和操作关联状态；Main 持有不可复用的文档 session、宿主所有权校验，并在导出请求期间读取 AX 和格式化 Markdown。

采用。它让状态贴近唯一能正确解释 DOM 的消费者，同时保留 Main 对特权操作的最终授权。

### 方案 B：Renderer 是 annotations 事实源

Guest 只回传选择结果，Renderer 保存列表并在需要时发回 Guest 或 Main。该方案看似符合常规 React 状态管理，但 Renderer 无法持有稳定 DOM identity；动态页面和 shadow DOM 会迫使它复制 selector 解析、重新同步和导航 reconciliation。拒绝。

### 方案 C：Main 是 annotations 事实源

Guest 每次变更写 Main，Renderer 订阅 Main，复制从 Main 读取。该方案集中数据，但 transient DOM-bound 状态没有 Main 侧消费者；Main 仍无法持有真实 Element，只能缓存不可靠的序列化影子，并继续承担双写和清理成本。拒绝。

### 为什么不使用现有数据系统

根据[数据系统选择](../../references/data/README.md)，该状态既不是 SQLite 业务数据、用户偏好、启动配置，也不需要跨窗口共享或持久化。把它放入 Cache 只会制造第二事实源。特权导出属于 imperative command，应使用[IpcApi](../../references/ipc/README.md)。

本方案不新增共享基础设施。`AnnotationSession` 是 WebviewService 的私有多实例助手，只服务一个活着的 WebContents；如果标注功能被移除，它也随之删除。

## 状态所有权

| 进程 | 拥有的状态 | 不得拥有的状态 |
| --- | --- | --- |
| Guest preload | annotations、annotation→Element 映射、选择模式、overlay/editor、未保存草稿、当前 `documentSessionId` | 宿主授权、AX/CDP 结果、跨 WebView 聚合状态 |
| Renderer | `enabled`、`count`、当前绑定的 WebView/target/session、清空确认框、复制 loading、pending request/operation | 完整 annotations 镜像、Main 快照、跨窗口全局状态 |
| Main | 每个 live WebContents 的随机 `documentSessionId`、状态阶段、监听器/disposables、该 WebContents 的 AX capture 队列 | annotations registry、UI 状态、持久化副本 |

Guest 是数据事实源，但不是信任根。Guest 和 Renderer 提交的 snapshot 一律视为不可信输入；Main 必须独立验证 caller、WebContents、partition、session 和 payload。

## 文档会话生命周期

每个 site-partition WebView 对应一个 `AnnotationSession`：

```text
ACTIVE(S1)
  ├─ same-document navigation ────────────────> ACTIVE(S1)
  ├─ main-frame new-document / reload ────────> NAVIGATING(S2)
  ├─ render-process-gone ─────────────────────> INVALID(S2)
  └─ WebContents destroyed ───────────────────> DISPOSED

NAVIGATING(S2) / INVALID(S2)
  ├─ dom-ready + start_session(S2) ───────────> ACTIVE(S2)
  └─ WebContents destroyed ───────────────────> DISPOSED
```

- `documentSessionId` 由 Main 使用 UUID 生成，不重复使用。
- 新文档导航在 `did-start-navigation` 且 `isMainFrame && !isSameDocument` 时立即轮换 ID，并使旧导出失效。
- `dom-ready` 时 Main 向新 Guest 发送 `start_session`。
- 相同 ID 的 `start_session` 是幂等操作，不清空；不同 ID 才执行完整 reset。
- `render-process-gone` 立即使旧 ID 无效，新的 Guest ready 后才重新进入 active。
- `destroyed` 从 service map 移除 session 并释放全部监听器和队列引用。
- service stop 对剩余 session 逐一 `dispose()`；dispose 可以安全重复执行。

## Guest 协议

协议继续使用专用 host↔Guest channel，但 schema 是单点严格判别联合。只有真正跨进程的 wire values 留在 `src/shared/`。

最小 annotation wire value 为：

```ts
type AnnotationPayload = {
  id: string
  comment: string
  element: ElementLocator
  region?: AnnotationRegion
}
```

不保留 `createdAt` 或 document `updatedAt`。当前 Guest 数组顺序就是当前文档的显示和导出顺序；本设计不再聚合、跨文档排序或恢复历史快照。

### Main → Guest

```ts
type MainCommand = {
  type: 'start_session'
  sessionId: string
}
```

### Renderer → Guest

```ts
type RendererCommand =
  | { type: 'configure'; sessionId: string; locale: AnnotationLocale; theme: 'light' | 'dark' }
  | { type: 'request_state' }
  | { type: 'set_enabled'; sessionId: string; enabled: boolean }
  | { type: 'deactivate'; sessionId: string }
  | { type: 'clear'; sessionId: string }
  | { type: 'request_snapshot'; sessionId: string; requestId: string }
```

`request_state` 是唯一不携带 session 的 Renderer 命令。Renderer 首次绑定时还不知道 Main 分配的 ID；Guest 用当前 state response 完成握手。Guest 尚未收到 `start_session` 时不响应。获得 ID 后，包括 `configure` 在内的所有其他命令都必须精确匹配它。

`configure` 只更新展示文案和主题，不清空 annotations；旧 session 的迟到配置同样被忽略。

### Guest → Renderer

```ts
type GuestEvent =
  | {
      type: 'state_changed'
      sessionId: string
      enabled: boolean
      count: number
    }
  | {
      type: 'snapshot_ready'
      sessionId: string
      requestId: string
      annotations: AnnotationPayload[]
    }
```

普通变更只发送摘要。完整 annotations 只在显式 `request_snapshot` 后返回一次，不再在每次编辑时跨进程广播。

Renderer 监听必须绑定到已确认 ready 的具体 `WebviewTag`，沿用 `WebviewContainer` 的 listener effect 和对称 cleanup 模式，不使用定时轮询。收到事件时检查原生 `ipc-message`、具体 event target、channel、strict schema、session 和 request；未知、迟到或重复 response 直接丢弃。

Renderer 观察到新文档导航或 render process gone 时，立即清空 UI 摘要、递增 operation generation，并把旧 session 标记为 retired。在收到不同 session ID 的 `state_changed` 前，旧 Guest 的迟到事件一律忽略。

## Renderer → Main 导出接口

只保留一个 IpcApi route：

```ts
type ExportAnnotationsInput = {
  webviewId: number
  documentSessionId: string
  target: {
    id: string
    label: string
  }
  annotations: AnnotationPayload[]
}

type ExportAnnotationsOutput = string
```

route 名称为 `webview.export_annotations`。输入 schema 为 strict object，并限制数组数量、字符串长度、selector、坐标和区域元素数量；annotations 至少一条且 ID 必须唯一。

Renderer 对全部导出失败都显示现有的统一复制失败反馈，不根据错误码分支，因此不增加 shared annotation error taxonomy。Main 可以记录内部失败类别，但不得记录评论、页面正文或完整 selector payload。

## 复制时序

1. Renderer 捕获 immutable operation key：`target.id + concrete WebviewTag + webviewId + documentSessionId + local operation generation`。
2. Renderer 为当前 session 生成 `requestId`，向 Guest 请求 fresh snapshot，并进入单飞 copying 状态。
3. Guest 只在 session 匹配时返回 structured-cloned snapshot；Renderer 只接收匹配 `requestId` 的一次 response。
4. Renderer 调用 `webview.export_annotations`，传入 snapshot、session、当前 target 和 webview ID。
5. Main 从 `IpcContext.senderId` 取得宿主窗口，验证：
   - guest 存在且未销毁；
   - 类型为 `webview`；
   - 使用 site WebView partition；
   - `guest.hostWebContents === hostWindow.webContents`；
   - service 中当前 session ID 与请求一致。
6. Main 再做 payload schema 和唯一 ID 等语义校验，将任务放入该 WebContents 的 AX capture queue。
7. Main 从真实 WebContents 读取 title/url，清洗 URL；逐条解析当前 accessibility context。单条 selector 或 AX 失败只产生该条 status。
8. AX 异步工作结束后，Main 再次校验宿主所有权、WebContents 存活和 session ID；不匹配则丢弃结果。
9. Main 使用纯 formatter 生成有长度上限的 Markdown，并返回 Renderer。
10. Renderer 再次比较 operation key。只有 target、WebView、session 和 local generation 全部未变，才调用 clipboard；否则丢弃。

导航、target 改变、unmount、Guest crash、WebContents 销毁都会递增 Renderer operation generation，并结束 pending request。迟到结果不得更新 UI 或剪贴板。

## 并发与幂等

- Renderer 每个控件同时只允许一个复制操作；复制按钮在 pending 期间 disabled。
- Main 按 WebContents 串行 AX capture，避免同一个 debugger/CDP target 并发 attach、detach 或命令交错。
- 排队任务开始前和完成后都验证 session；仅在入队时验证不足以阻止导航竞态。
- `state_changed` 是可覆盖摘要；最新 session 的最新值生效，不需要队列。
- `snapshot_ready` 是 request/response；一个 `requestId` 最多结算一次。
- 相同 session 的 `start_session`、重复 deactivate 和重复 dispose 都是幂等的。
- WebContents 数字 ID 可能在未来被复用，不能替代随机 session ID。

## 安全与输入边界

### Guest/Renderer 边界

- 网站页面不暴露 annotation bridge API；只有隔离 preload 使用 `ipcRenderer.sendToHost`。
- Renderer 只处理绑定 WebView 发出的原生 annotation-channel 事件，并进行 strict schema 校验。
- session/request 匹配用于防止重放和迟到消息，但不承担 Main 授权。

### Renderer/Main 边界

- `webviewId`、target 和 annotations 均不可信。
- Main 的 sender/host/partition/type/session 校验是唯一授权依据。
- session ID 是关联令牌，不是独立 capability；知道 ID 不能绕过 host ownership。
- Main 在异步边界前后重复授权，防止检查后使用时状态变化。

### 页面内容

- title、URL、visible text、ARIA、role、selector 和评论都按不可信数据处理。
- title/url 只能从真实 WebContents 读取，不接受 Guest 提交的 page metadata。
- URL 删除 credentials、query 和 hash，并限制允许输出的 scheme 信息。
- Markdown 对所有内联元数据和评论做上下文正确的转义，保留 untrusted-data 提示。
- accessibility 遍历有节点数、深度、文本长度和超时预算。
- 导出总长度在 shared output schema 和 formatter 两侧受限。

## Guest 交互不变量

状态收敛不能掩盖当前 DOM 交互缺陷，实施时必须同时满足以下用户可观察规则：

- 只有 annotation mode enabled 时才拦截页面交互。
- 区域拖拽只接受可信、主指针、左键；用启动时的 pointer ID 捕获、更新和释放。
- 第二指针、错误 pointer ID、pointer cancel、Escape、失活和 dispose 都不能提交错误区域。
- 通过 `event.composedPath()` 排除 input、textarea、select 以及任意 contenteditable 祖先，包括 shadow DOM 中的编辑控件。
- overlay 自己的事件不进入页面选择逻辑。
- 区域在创建时存为 page coordinates；展示时用当前 scroll 投影为 viewport coordinates。
- 滚动只改变投影位置。页面之后发生 reflow 时，不重新解释已捕获矩形为新的内容区域；无法解析的 element annotation 隐藏 pin，导出时给出不可用 status。

## 模块边界

### Main

```text
src/main/services/webview/
  index.ts                 # 唯一公开入口
  WebviewService.ts        # lifecycle owner、既有 WebView 行为、live session map
  AnnotationSession.ts     # 一个 live WebContents 的 session/listeners/AX queue
  annotationExport.ts      # 私有、请求期校验与导出编排
  annotationMarkdown.ts    # 私有纯 formatter
  annotationTypes.ts       # Main-only Page/AX/resolved/CDP types
  __tests__/
```

`WebviewService` 继续使用[lifecycle system](../../references/lifecycle/README.md)，因为它拥有 app/WebContents 的长生命周期监听器。`AnnotationSession` 是多实例 helper，不注册为 lifecycle service，也不使用 `Service` 后缀。

现有 `setOpenLinkExternal` 和其他 WebView API 保持行为不变，经 `services/webview/index.ts` 明确 re-export。`src/main/ipc/handlers/webview.ts` 和 `serviceRegistry.ts` 只从 barrel 导入。该布局遵守[Main Process Architecture](../../references/architecture/main-process.md)的 headless service topic 约定。

### Renderer

```text
src/renderer/components/WebviewAnnotationControls/
  index.ts
  WebviewAnnotationControls.tsx
  useWebviewAnnotationSession.ts
  __tests__/
```

组件只负责按钮、badge、确认框、loading 和 toast；私有 hook 负责具体 WebView listener、握手、session 摘要和 pending operation。该 hook 不提升为全局 shared hook，因为只有一个实际 consumer。`MinimalToolbar` 只组合公开组件，符合[Renderer Architecture](../../references/architecture/renderer.md)的 consumer-driven ownership。

### Preload

```text
src/preload/webview.ts
src/preload/WebviewAnnotationController.ts
src/preload/__tests__/WebviewAnnotationController.test.ts
```

`webview.ts` 只装配协议和 controller。当前 controller 虽大，但进一步拆分 DOM/overlay 不是跨进程状态设计所必需；本次只做修复不变量所需的手术式修改。

### Shared

```text
src/shared/types/webviewAnnotation.ts
src/shared/ipc/schemas/webview.ts
```

shared 文件只包含跨进程 `AnnotationPayload`、locale/theme、Guest command/event schema、limits 和 IpcApi route schema。Page document、AX node、resolved annotation、formatter option 等 Main-only 类型移入 Main 私有模块，符合[Shared Layer Architecture](../../references/architecture/shared-layer.md)。

## 删除的旧路径

- Main `AnnotationRegistry` 和 `webview.annotations` Cache key；
- `getAnnotationRegistry`、`setAnnotationRegistry`、`replaceAnnotations`、`clearAnnotations` 等镜像管理；
- `webview.replace_annotations`；
- `webview.get_annotations_markdown`；
- Renderer 每次 `state_changed` 后的全量 snapshot 同步；
- Renderer 完整 annotations state；
- numeric `navigationRevision`；
- shared 中只被 Main 使用的 page/document/accessibility/resolved schemas；
- 仅用于跨文档排序的 `createdAt` 和 `updatedAt`；
- 仅为旧镜像链路存在的 shared error code。

不保留 deprecated alias、fallback 或双写，因为该 PR 尚未合并，没有已发布调用方或磁盘数据需要迁移。

## 错误处理

- Guest command schema 错误、session 不匹配和未知 request：静默忽略，可记录不含 payload 的 debug 信息。
- Renderer 无法取得 snapshot、Main 拒绝请求、AX orchestration 失败或 clipboard 写入失败：结束 loading，不改剪贴板，显示统一复制失败 toast。
- snapshot 为空：不调用 Main，也不改剪贴板。
- 单条 selector 不存在、AX unavailable/timeout/budget exceeded：导出该 annotation，并附带对应 accessibility status。
- Main 所有权或 session 校验失败：整个导出失败，不返回部分 Markdown。
- 页面销毁：立即清队列引用并拒绝后续任务；不能继续使用缓存的 WebContents 对象。

## 验证策略

测试遵守[Frontend Testing Guidelines](../../references/testing/frontend-testing.md)：每个用例必须保护产品契约或已观察到的回归，并使用最低充分层；不写只断言 mock 被调用、组件能渲染或当前实现细节的测试。

### Shared contract tests

保护以下回归：

- 未知字段、超限 comments/selectors/arrays/coordinates 被接受；
- 缺失或非法 session/request ID 的受保护命令通过；
- output 超过 Markdown 上限；
- duplicate annotation IDs 绕过语义校验。

### Guest controller tests

保护以下回归：

- 新 session 未清空旧 annotations；相同 session 重发反而清空；
- 旧 session 的 enable/clear/snapshot 修改或读取新文档；
- deactivate 删除已提交 annotations，或保留未保存草稿；
- input/textarea/select/contenteditable/shadow editable 被选择模式拦截；
- 第二指针或错误 pointer ID 提交 marquee；
- scroll 后 page→viewport 投影错误；
- detached element、cancel、Escape 和 dispose 留下 overlay/listener。

### Renderer hook/component tests

保护以下回归：

- ready WebView 重渲染导致重复 listener 或旧 WebView listener 泄漏；
- wrong target/channel/schema/session/request response 更新 UI；
- target 切换、导航或 unmount 后的迟到 snapshot 写剪贴板；
- same-document navigation 错误清空 count；
- 双击复制产生多个并行请求或多次 clipboard 写入；
- Guest 返回空 snapshot 时仍调用 Main；
- 成功路径复制 Main 返回的 Markdown，并给出可访问的 loading/成功反馈。

### Main session/export tests

保护以下回归：

- 非 site partition、非 WebView、其他窗口拥有的 guest 被导出；
- 仅凭复用的 numeric WebContents ID 绕过 session；
- 完整导航/reload/render-process-gone 未轮换 session，或 same-document 错误轮换；
- AX 等待期间导航后仍返回旧 Markdown；
- 同一 WebContents 的 capture 并发执行；
- destroyed/stop 后 listener、map 或强引用仍存在；
- payload 中伪造 title/url 覆盖真实 WebContents metadata；
- service 仍访问 CacheService 保存 annotations。

### Formatter tests

保护 Markdown 元数据/评论注入、URL credential/query/hash 泄漏、输出上限、Guest 顺序编号和单条 AX 状态降级。使用聚焦断言，不生成大型 snapshot。

### Tracked Electron 验证

1. 当前 WebView 创建元素和区域 annotations，复制只包含当前页和当前 target。
2. 两个并列 WebView 各自创建 annotation，切换和复制互不串数据。
3. 宿主失活后选择模式和草稿关闭，恢复后已提交 count/pins 仍在。
4. hash/pushState 保留 annotations；reload 和新文档导航清空。
5. 复制请求进行中触发导航，剪贴板保持原内容并显示失败反馈。
6. 编辑器和 contenteditable 页面仍可正常点击、输入和选择文本。
7. 区域拖拽后滚动页面，pin 位置与已定义的 page-coordinate 语义一致。
8. 关闭、重开或 crash Guest 后，旧 snapshot 不会导出到新 WebView。

仓库当前没有 WebView E2E fixture，Playwright 只有应用启动级基础设施。本次不顺带建立新的 E2E 框架；完整跨进程结果在 tracked Electron 中验证，竞态由可控延迟的单元/组件测试覆盖。PR 验证记录必须明确这一限制。

### 命令验证

- 开发中运行最接近改动的 main、renderer、preload/shared Vitest 文件；
- 完成后运行 `pnpm lint`；
- 因为变更跨 Shared、Preload、Renderer、Main、IPC 和 lifecycle，最终运行 `pnpm build:check`；
- 不使用会意外运行多个完整项目的 `pnpm test <path>`。

## 一次性切换顺序

1. 先以失败测试固定新 session、snapshot 和竞态契约。
2. 建立最小 shared wire schema 和 Main 私有类型，不保留旧 document registry 类型。
3. 引入 `AnnotationSession` 与单请求 export orchestration，覆盖所有权和双检。
4. 切换 Guest/Renderer 到摘要 + request-scoped snapshot 协议。
5. 在同一可构建变更中切换 IpcApi caller，并删除旧 routes、Cache registry、revision 和同步 effect。
6. 整理 Main/Renderer 文件边界，保留无关 WebView 行为不变。
7. 运行目标测试、tracked Electron 场景和完整 gate。

旧链路不经历兼容期；任何阶段都不得同时让 Cache snapshot 和 Guest snapshot 成为可用导出来源。

## 最终验收

1. 代码搜索不到 annotation Cache registry、旧 replace/get routes 和 numeric navigation revision。
2. Guest 是唯一完整 annotations owner，Renderer 和 Main 均没有常态副本。
3. Main 对每次导出执行宿主所有权、partition、类型和 session 双重校验。
4. 当前视图成功复制；其他 WebView、旧 target 和旧文档无法影响结果。
5. 所有已确认导航、失活、same-document、crash 和销毁语义通过测试与 tracked Electron 验证。
6. 页面编辑控件、多指针和区域坐标回归被覆盖。
7. WebContents 销毁和 service stop 后没有 annotation listener/queue 强引用泄漏。
8. 没有新增数据表、Cache key、Preference、全局 Renderer store、通用基础设施或兼容层。

## 设计自检

- 状态所有权按真实 DOM consumer 划分，同时明确 Guest 不可信，避免把“事实源”误解为“授权源”。
- Main 只保留必须跨异步边界验证的 WebContents session；没有为单一功能创建通用状态框架。
- Renderer API 由现有唯一消费者驱动，未预留聚合、持久化或多窗口配置。
- IpcApi 只承载 Renderer→Main 的特权命令；Guest bridge 只承载 host/Guest 协议，边界清楚。
- 新文档、same-document、target、宿主失活和销毁语义互不冲突。
- AX 失败是单 annotation 降级；授权/session 失败是整体拒绝，错误粒度与风险一致。
- 文件移动仅收敛 annotation topic；没有将无关 WebView 代码纳入重构。
- 验证覆盖了导致本次大量 review 问题的根因：双份状态、迟到异步结果、不可信消息、DOM 输入边界、坐标语义和 listener 生命周期。
