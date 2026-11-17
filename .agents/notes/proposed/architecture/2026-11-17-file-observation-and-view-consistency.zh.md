# Agent Note: 文件观察归属与视图一致性

Status: proposed

[English](2026-11-17-file-observation-and-view-consistency.md) | 中文

## 问题

外部程序、Agent 和编辑器可以独立修改同一个文件系统。目录成员、文件内容、本地草稿和视图状态有不同的所有者与生命周期。文件名或字节数不变，不能证明内容仍是最新；重新连上 watcher，也不能证明旧缓存仍然有效。

当前代码可独立复现两个问题：目录折叠期间发生外部增删，重新展开后仍复用旧列表；文件发生等长或非等长外部写入后，已打开的预览仍显示旧内容。前者的第一个状态分歧在[文件面板树模型](../../../../src/renderer/components/chat/panes/useArtifactFileTreeModel.ts)：列表缓存与订阅被分开维护。后者在[预览宿主](../../../../src/renderer/components/chat/panes/ArtifactPane.tsx)：它没有完整的内容观察链路；[目录树 builder](../../../../src/main/services/file/tree/builder.ts) 只有启用 `withStats` 才发送内容更新。[#23347](https://github.com/CherryHQ/cherry-studio/issues/23347) 和 [#24151](https://github.com/CherryHQ/cherry-studio/issues/24151) 是本次排查的反馈来源；后者的宽泛症状不能全部归因于这两次复现。

有界 TLA+ 模型暴露了这两个问题，并检查了候选目标的安全不变量。有限版本、抽象读取及缺少公平性约束，不能证明实现正确性、更新时间或最终收敛。真实文件系统与 IPC 重放证明的是当前缺陷，不是本方案的验收结果。

本方案新承接文件观察与投影一致性的决策，部分接替[独立编辑实例](2026-10-23-independent-file-edit-lifecycle.md)中延后观察能力的范围决定，同时保留独立草稿、现有写入租约、条件保存和恢复。[更早的生命周期提案](2026-10-22-file-edit-session-lifecycle.md)继续作为备选方案的来源，不构成额外交付清单。本方案不恢复共享草稿、别名合并、写者选举或窗口关闭协调器。

## 方案

### 状态归属与范围

| 状态 | 所有者 | 契约 |
|---|---|---|
| 物理监听覆盖范围与健康状态 | Main `FileObservationService` | 持有原生资源，报告失效或观察中断；不把通知当作当前文件字节 |
| 目录成员投影 | Main builder，以及每个请求投影对应的一个 renderer `DirectoryTreeSession` | 先安装完整基线，再消费有序更新；替换某目录的子项，而不是与过期条目做并集 |
| 已加载的文件内容 | 预览 source 或编辑实例 | 读取绑定资源和观察修订号；拒绝已被取代的结果 |
| 本地草稿与保存基线 | 独立的 `FileEditSessionManager` 会话 | 观察可以请求重新验证，但不能替换脏内容或确认保存成功 |
| 展开、选中、标签、缩放与滚动 | 功能／视图 | 改变展示需求，不决定其他消费者的观察生命周期 |

交付覆盖目录树、统一的 `FilePreview` 宿主及现有 Notes／Skills／Agent 编辑消费者。沿用文件引用和读写授权。观察属于运行时状态，不新增数据库表、DataApi 端点、Preference 或持久缓存。搜索仍是显式、有界查询；搜索结果不是第二份权威目录列表。

### 文件组织

以下是目标布局。未列出的文件保留现有归属；实施时移除被替代的逻辑，不保留两条同时工作的观察链路。

```text
src/main/services/file/
├── index.ts
├── observation/
│   ├── FileObservationService.ts
│   └── WatchScope.ts
├── watcher.ts
├── tree/
│   ├── DirectoryTreeManager.ts
│   └── builder.ts
├── FileManager.ts
└── FileEditService.ts

src/main/ipc/handlers/
├── file.ts
└── fileObservation.ts

src/shared/ipc/schemas/
├── file.ts
├── fileObservation.ts
└── ipcSchemas.ts
src/shared/utils/file/tree.ts

src/renderer/services/
├── DirectoryTreeSession.ts
├── fileObservation/
│   ├── index.ts
│   ├── FileObservationService.ts
│   └── FileObservationSession.ts
└── fileEdit/FileEditSessionManager.ts
src/renderer/hooks/
├── useDirectoryTree.ts
├── useFileObservation.ts
└── useFileEditSession.ts
src/renderer/components/FilePreview/
├── FilePreview.tsx
├── ElectronFilePreview.tsx
└── plugins/
src/renderer/components/chat/panes/
├── useArtifactFileTreeModel.ts
└── ArtifactPane.tsx
```

| 文件或文件组 | 必要改动 |
|---|---|
| Main `observation/FileObservationService.ts` | 新增生命周期服务，持有物理 scope、进程内租约、renderer 订阅、失效修订号与观察健康状态 |
| Main `observation/WatchScope.ts` | 每个 scope 的私有实例，封装 `DirectoryWatcher`、就绪、引用计数与关闭；不是另一个服务／单例 |
| Main `watcher.ts` | 保留 chokidar 适配器和现有 dangling 存在性联动；迁移后由 builder 直接持有实例的做法被移除 |
| Main `tree/builder.ts` 与 `tree/DirectoryTreeManager.ts` | 获取观察租约，保留扫描／索引／投影和现有 renderer 交接协议，向上传递新鲜度丢失与基线重置 |
| Main `ipc/handlers/fileObservation.ts` | 薄的所有者／句柄适配器，经现有文件边界解析 entry/path 请求，再委托观察服务 |
| Shared `ipc/schemas/fileObservation.ts` | 拥有请求／事件 schema 及推导的传输类型，接入 `ipcSchemas.ts` 和 `src/main/ipc/handlers/ipcHandlers.ts`，不增加第二套 preload API |
| Shared `utils/file/tree.ts` | 扩展投影更新，表达基线替换和 stale/unavailable 状态；不在这里编码本地草稿 |
| Renderer `services/DirectoryTreeSession.ts` | 从 `useDirectoryTree` 提取现有私有会话，普通与懒加载目录消费者复用同一套基线／更新实现 |
| Renderer `services/fileObservation/*` | 窗口内注册表和按资源管理的订阅会话，供兼容观察者共享；不持有草稿、撤销或文件字节缓存 |
| Renderer hooks | 把 React 需求绑定到无界面会话；hook 不拥有第二套 IPC 协议或原生资源 |
| `FilePreview`、Electron 适配器和本地插件 | 在统一宿主获取当前文件观察，同步失效元数据与内容，并在 source 读取／提交时拒绝过期结果 |
| 文件面板树／面板和现有编辑消费者 | 消费上述能力；删除重复的懒加载列表缓存／握手，以及按文件大小失效预览的逻辑 |

新增运行时代码全部放在现有进程分类下。Main 现有 file barrel 是公共边界，`observation/` 不建立嵌套 barrel。renderer 的 observation topic 只暴露一个显式重导出 barrel，并用规则封闭深导入。`DirectoryTreeSession.ts` 保持为扁平的多实例类。跨进程类型从 shared schema 推导，scope 账本留在 Main，renderer 的读取状态留在 renderer。

### 为什么拆出观察服务

必要的边界是观察需求独立：折叠或释放目录树，不能停止已打开的预览或编辑器仍然需要的观察。这个边界不必通过新增生命周期服务实现。下面两种组织方式都能满足它：

| 决策 | 拆出 `FileObservationService` | 演进现有 `DirectoryTreeManager` |
|---|---|---|
| 运行时入口 | 保留树管理器，新增一个观察服务 | 扩展并重命名现有服务，不增加注册项 |
| 资源归属 | 观察服务持有原生 scope，树管理器持有共享投影 | 一个服务同时管理 scope 与投影注册表，在内部区分生命周期 |
| 只观察文件的消费者 | 获取观察，不构造目录树 | 增加绕过目录树构造的文件订阅 API |
| 现有行为 | 保留树消费者与交接协议，将原生资源所有权下移 | 保留现有生命周期机制，在内部拆开目录树专属状态 |
| 接受的成本 | 增加一个服务依赖，以及需要显式清理的租约边界 | 扩大公共 API，由同一生命周期所有者协调两类资源 |

本方案选择拆分，因为两类消费者已经存在，而且资源生命周期不同。只要兼容的树、预览或编辑器仍有需求，物理 scope 就应保留；目录树投影则只随树消费者的需求保留。分开这两个所有者，让只观察文件的消费者无需构造树快照、过滤结果和变更状态，同时让树管理器保留职责集中的投影 API。演进现有管理器也是有效替代方案，可以提供相同的外部行为；服务数量本身不能决定边界。生命周期规范约束选定的所有者如何受管，并不要求一定引入另一个所有者。新增服务本身不构成性能收益的依据。

拆分要迁移所有权，避免增加第二套原生监听管理：

| 现有职责 | 目标归属与复用 |
|---|---|
| builder 创建 `DirectoryWatcher`、等待就绪并关闭它 | 迁入 `FileObservationService` 下的 `WatchScope`；builder 消费并释放租约，不再创建原生 watcher |
| manager 对 builder 去重、统计树消费者并提供释放宽限期 | 留在 `DirectoryTreeManager`，管理投影生命周期；物理 scope 的共享与最终关闭只由观察服务负责 |
| 树 ID、窗口所有权、快照激活与变更修订号 | 在 `DirectoryTreeManager` 保留现有树协议；文件订阅使用自己的 ID 与失效修订号，复用同一 IPC 基础设施 |
| 获取、所有者校验、交接与清理行为 | 复用现有契约和相关实现；只有两条路径确实需要时才提取共享 helper，不另建传输层或预设的通用注册表 |

两个服务都可以观察窗口销毁，因为它们释放的是不同的所属订阅。释放树消费者时，可以销毁投影并释放该投影的租约；底层 scope 是否仍有其他租约，只由观察服务决定。迁移必须验证关闭树后仍存活的预览能继续观察，以及最后一次释放只关闭一次原生资源，归入 AC7 与 AC8。

### 主进程服务依赖

下图箭头表示依赖，不表示事件流向。虚线是 IPC 边界的分派调用。现有 core 与持久化依赖只做摘要，不在此重新定义。

```mermaid
flowchart TD
    Tree[DirectoryTreeManager] --> Observe[FileObservationService]
    Tree --> Windows[WindowManager]
    Observe --> Windows
    Observe --> Power[PowerService]
    Observe --> Scope[WatchScope]
    Scope --> Watcher[DirectoryWatcher]
    Watcher --> Chokidar[chokidar and filesystem]
    Edit[FileEditService] --> Files[FileManager]
    Edit --> Windows
    Files --> Power
    Files --> Jobs[JobManager]
    Router[fileObservation IPC handler] -.-> Observe
    Router -.-> Files
```

| 生命周期服务 | 阶段及显式同阶段依赖 | 原因 |
|---|---|---|
| `FileObservationService` | `WhenReady`；`@DependsOn(['WindowManager', 'PowerService'])` | 在所属窗口销毁时释放 renderer 订阅；系统恢复后将活跃观察标记失效 |
| `DirectoryTreeManager` | `WhenReady`；`@DependsOn(['WindowManager', 'FileObservationService'])` | 持有目录树消费者，同时使用下层观察租约 |
| `FileEditService` | 保留 `WhenReady`；`@DependsOn(['FileManager', 'WindowManager'])` | 固定目标的读写与所有者清理不依赖通知是否可用 |
| `FileManager` | 保留 `WhenReady`；`@DependsOn(['PowerService', 'JobManager'])` | entry 生命周期、存储与清理维持现有归属 |

只在 `src/main/core/application/serviceRegistry.ts` 新注册 `FileObservationService`，通过现有 file barrel 导出服务类。运行时使用 `application.get('FileObservationService')`。scope 辅助对象和 renderer 会话都是普通实例，不是生命周期服务。

观察服务在进程内接受已验证的文件系统 scope。它不解析 `FileEntry` 行，不导入 `@main/data`，不依赖 `FileManager`／`DirectoryTreeManager`／`FileEditService`，也不把 `IpcApiService` 作为启动依赖。IPC 适配器先经 `FileManager` 解析 entry 句柄再获取 scope，path 句柄沿用现有路径策略。这条调用边不能变成隐藏的服务依赖。定向推送沿用目录树 manager 已使用的所属 WebContents 事件传输。core 服务不反向依赖文件服务。

`DirectoryTreeManager` 为每个共享 builder 获取一个进程内观察租约，并把租约传给 `createDirectoryTree`／builder。builder 显式接收事件源，不查询服务容器，也不创建原生 watcher；租约在初始扫描前已就绪；构建基线期间收到的失效通知会被保留并校准，之后才能把基线视为当前状态。builder 清理时释放租约。物理 scope 共享与投影共享分开，观察服务不构造目录树。

新服务使用生命周期清理和类型化事件。退出时停止接收新请求并释放全部 scope；依赖顺序保证先清理目录树，再清理观察。窗口关闭只释放本窗口订阅，其他窗口或进程内消费者仍可保留 scope。即使观察不可用，文件写入仍由现有编辑服务排空。

### 范围与身份

目录观察覆盖目录投影明确要求的深度和剪枝策略。文件观察覆盖请求文件的有效地址，以及检测替换所需的父目录／别名路径，不随目录树折叠而消失。监听父子关系以识别原子替换，而不是只绑定旧 inode。

只在物理覆盖等价且原生过滤兼容时共享资源。不能把显式文件观察扩大为无界工作区观察，也不能为了共享资源而移除递归树对依赖／构建目录的排除。独立的文件 scope 可以观察显式打开的隐藏或 gitignored 文件，即使目录树不展示它。`withStats` 只控制元数据采集，不决定是否发送内容失效通知。

保留原始 locator 和现有解析策略。订阅 ID 不是永久文件身份、读取权限或写入租约。符号链接／entry 改向触发重新验证与显式重新绑定；观察不能把编辑实例悄悄迁移到新目标。所有者发起的重命名／移动／删除仍使用现有 prepare/finish 契约，即使没有文件系统事件，也要使旧绑定失效。

### Renderer 依赖与需求

```mermaid
flowchart TD
    TreeModel[Artifact tree model] --> Directory[DirectoryTreeSession]
    TreeHook[useDirectoryTree] --> Directory
    Directory --> TreeIPC[file.tree IPC]
    Preview[FilePreview host] --> ReactHook[useFileObservation]
    ReactHook --> Registry[Renderer FileObservationService]
    Editor[FileEditSessionManager] --> Registry
    Registry --> Session[FileObservationSession]
    Session --> ObserveIPC[file.observe IPC]
    Preview --> Reads[Existing file read and metadata IPC]
    Editor --> Writes[file.edit IPC]
    View[ArtifactPane and feature pages] --> TreeModel
    View --> Preview
    View --> Editor
```

renderer 注册表是具名的窗口内单例 `fileObservationService`，不是 React Provider。它按受支持 locator 的原始值和观察策略索引订阅，不合并别名或草稿所有者。`useFileObservation` 是其外部 store 适配器；文件编辑会话直接获取同一无界面能力，服务不导入 hook／组件。

| 消费者需求 | 订阅生命周期 | 返回／恢复契约 |
|---|---|---|
| 可见树根与已展开目录 | 持有投影会话；折叠时释放该目录的需求，保留有界复用宽限期 | 释放后重新获取基线，不能只凭缓存子项证明新鲜度 |
| 活跃预览 | 持有当前文件观察，与树是否展开无关；隐藏视图可在有界宽限期内复用 | 可见性恢复时重新验证，释放后重新获取基线 |
| 已挂接编辑器或待完成保存 | 编辑实例持有观察，独立于树／组件挂接 | 用当前草稿／会话代次保护读取 |
| 已脱离但保留的草稿／失败／冲突 | 有界宽限期后释放观察，保留独立草稿／恢复实例 | 重新挂接时验证；没有连续观察时，条件保存仍是权威 |

提取出的 `DirectoryTreeSession` 拥有基线安装、激活、修订号验证和重置处理。文件面板模型只拥有展开需求和到 `FileTreeNode` 的投影。每个展开目录使用同一会话实现，最新快照替换该目录的子项。移除 `LazyDirectoryWatcher`、展开时独立调用 `listDirectoryEntries` 的路径，以及对过期子项列表做加法合并的逻辑。`loadFolder` 获取必要的目录会话，不展开 UI 行。显式搜索可以保留当前有界列表 API。

统一的 `FilePreview` 宿主观察当前资源，包括 Agent 工作区之外的预览。插件消费宿主的 source／刷新代次，不自行建立 watcher。按同一代次重新读取元数据与字节，元数据响应本身不能把旧内容标记为最新。本地 text／Markdown／HTML 插件与现有 portable preview 适配器都要拒绝已被取代的 source 结果。在格式支持原位替换时保留视图状态。portable package 不依赖 Electron／IPC／服务，沿用其现有 source 和 refresh 契约。

已挂接编辑器独立于树观察自己的绑定资源。保存中会话保留观察，直到已接收的操作结束。已脱离的脏／失败／冲突会话在有界宽限期后释放观察，同时保留草稿和现有恢复状态；重新挂接后先重新验证再接纳磁盘内容，每次保存仍验证基线。已完成且脱离的会话释放租约。获取失败时同时释放部分订阅和已打开的编辑租约。观察回调调用带保护的重新验证：干净会话可接纳新字节；脏会话保留草稿并比较磁盘基线。Notes／Skills 消费者迁移后，移除树到编辑器的通知转发，避免同一事件触发两次读取。保存确认仍以写入回复为准，不以 watcher 回声为准。

### 协议、新鲜度与恢复

| 边界 | 契约 |
|---|---|
| `file.observe.open` | 接受 `FileHandle`，验证受管窗口发送方及现有解析策略，返回所属订阅 ID、基线修订号和观察覆盖状态，不读取文件正文 |
| `file.observe.activate` | renderer 先安装监听器再激活，回放有界缓存中的失效通知，包括建立期间的变化 |
| `file.observe.changed` | 只向所有者发送有序失效／覆盖状态更新；即使 size/mtime 看似不变，内容变化也使已有认识失效 |
| `file.observe.close` | 幂等释放一个订阅；已关闭或被替代的代次不能向后继发布结果 |
| 现有 `file.tree.*` | 保留快照／监听器／激活契约，扩展更新以承载完整基线重置及显式 stale/unavailable 状态 |
| 现有读写路由 | 继续作为字节、元数据、目标验证和保存结果的权威；观察不替代它们 |

订阅 ID 标识其生命周期，单调递增的流修订号用于检测该生命周期内的重复／断档和读取过期。磁盘版本／哈希与草稿修订号继续分开。已有身份足以阻止旧结果提交时复用它，不为同一事实增加另一个计数器。

可信的首次读取只能在观察就绪且完成监听器／激活交接后开始。建立期间可以展示旧缓存快照，但就绪后必须重新验证。每个消费者在读取前捕获资源、订阅和读取修订号。提交前任一项变化，结果即过期；保留最新失效标记并再次读取。合并失效需求，每个消费者最多有一个进行中的校准读取。以带版本的读取结果为准给接纳的内容加戳，不能使用更早的元数据预检结果。一致／有界读取检查留在现有文件读取 helper 与 source 适配器，不进入观察服务。这是一套失效状态机，不是每个原始事件都排队重读一次大文档。

正在建立、中断和恢复中的订阅，都不能证明缓存内容仍然有效。显式观察状态区分 starting、live coverage、stale coverage 和 unavailable coverage；观察链路活跃本身，不代表消费者已经读到最新内容。文件缺失要与空内容、观察失败分开。启动／恢复、流断档、watcher 失败、焦点／可见性返回和显式重试时，将对应消费者标记过期并校准。树的基线重置替换投影；观察中断不能只写日志，却让镜像永久看起来健康。

沿用现有有界建立／重试行为；重试耗尽后保留可操作的 stale/error 状态。本方案保证在收到失效通知或显式恢复触发、且读取成功的条件下完成校准，不承诺固定时延或对操作系统无限期无声漏事件的自主恢复。周期性完整性扫描需要独立决定成本与保证。不能每次事件都哈希所有文件，也不能扫描未使用的整个工作区。

### 实施顺序与移除项

| 层 | 交付与移除项 | 验证所有者 |
|---|---|---|
| 1. Main 观察 | 服务注册、scope 租约、按所有者定向的协议及失败／恢复通知，迁移 builder 对原生 watcher 的所有权 | Main 文件系统／协议测试；AC1、AC2、AC6、AC7 |
| 2. 目录投影 | 提取可复用的 renderer 会话，增加 reset/status 并迁移懒加载目录，删除重复缓存和握手 | Renderer 与 Electron；AC1、AC5、AC6 |
| 3. 文件消费者 | 接入预览宿主和独立编辑会话，移除按大小失效及重复的功能层转发 | Renderer、file-preview 适配器与 Electron；AC2、AC3、AC4、AC5、AC7 |
| 4. 验收 | 重放真实事件／读取竞争和 Windows 反馈场景，按实际交付归属对齐文件领域参考文档 | Main、renderer、Electron 与 docs；AC1–AC8 |

每层保证受影响消费者仍可工作，已迁移消费者只走一条路径；最终实现删除未使用的导出、监听器与协议分支。遵循现有 Spec-first stack 流程。本文件保持 proposed，直到已批准的验收条件都有实际证据；模型通过不是实现验收。

## 考虑过的替代方案

- 演进并重命名 `DirectoryTreeManager`，将其作为统一观察入口：只要文件观察能绕过目录树构造，就能在不增加服务注册的前提下满足相同行为。上面的比较选择接受额外服务边界，以分开原生观察覆盖与目录投影的所有权。
- 在重新展开时增加刷新调用，并在目录树 watcher 上启用 `withStats`：能修复部分路径，但内容新鲜度仍耦合树的可见性／元数据策略，目录状态仍重复维护。
- 为每个工作区永久保留递归 watcher：能避开部分可见性空窗，但会付出隐藏工作区 I/O 和原生句柄成本；范围应跟随消费者需求。
- 每个预览插件和编辑器各建 watcher：重复所有权、错误恢复与交接逻辑，折叠／清理行为会再次分歧。
- 把内容观察、共享草稿和写入合并成通用文件资源服务：会把本决策扩大到编辑设计已经分离的身份、写者选举和持久化语义。
- 把原生事件或有序 IPC 修订号当作无损文件系统日志：它们都不保证完整历史、一致字节或保存确认，只用于触发校准。

## 验收条件

- AC1 — 深层目录折叠期间发生外部修改，再展开后，无需额外文件系统事件即可让列表收敛，包括删除缓存中的后代项（verification: renderer and Electron; owner: directory projection）。
- AC2 — 目录树折叠时，已打开的文件仍能在等长写入、原子替换和删除／重建后更新，包括显式打开的隐藏／ignored 文件及工作区外文件（verification: Main filesystem tests and Electron; owner: file observation and preview）。
- AC3 — 外部变化更新干净编辑器，但保留独立的脏／失败草稿并暴露已确认冲突；其他功能的草稿和撤销状态保持独立（verification: renderer and Electron; owner: file edit sessions）。
- AC4 — 加载期间失效，或被另一个文件／工作区取代的读取，不能提交过期内容或错配的 source 元数据；最后一次成功的当前读取可见（verification: renderer and real-source adapter tests; owner: preview source and edit sessions）。
- AC5 — 基线获取到激活之间的变化、重复推送和修订号断档，不会形成静默过期镜像；恢复时先安装新基线，再宣布投影就绪（verification: Main protocol and renderer tests; owner: observation transport and directory sessions）。
- AC6 — watcher 错误或系统恢复会使相关视图失效，区分 missing/stale/unavailable 与空内容，并允许无需重启应用即可恢复（verification: Main fault injection and Electron; owner: observation lifecycle）。
- AC7 — 等价 scope 的消费者共享原生资源；关闭／折叠一个消费者不影响其他观察者，释放最后一个消费者或所属窗口后，在有界宽限期内释放资源，且不扩大递归观察范围（verification: Main lifecycle/resource tests and Electron; owner: observation service）。
- AC8 — 最终代码只有一个原生监听所有者和一套 renderer 目录交接实现，移除过期的面板缓存／通知转发，依赖保持无环，配对的文件领域参考文档描述实际交付契约（verification: scoped imports/change review and docs gate; owner: integration）。

## 风险

- 拆开 scope 与投影生命周期后，可能遗留租约，或在其他消费者仍有需求时关闭 watcher。迁移现有原生资源所有权，保留显式租约释放，验证树／预览的释放顺序与窗口清理；不能继续保留 builder 原有的 watcher 路径。
- 共享物理观察可能意外扩大递归范围或改变过滤。只共享兼容 scope，并在真实代码工作区测量原生句柄／扫描行为。
- 首次读取／激活／恢复的竞争可能发布过期内容。保留现有交接协议，验证具体竞争路径，不依赖只统计回调次数的 mock。
- 校准可能反复解析大文件。合并需求，在允许的重载期间保留过期内容，维持格式自身的字节／range 上限，不引入无界共享内容缓存。
- 本方案重新承接曾被延后的观察职责。把改动与草稿身份、持久化、关闭协调和崩溃恢复隔离，并与本 Spec 一起更新前一所有者的链接。
- 跨平台 watcher 行为和无声漏事件限定了保证边界。macOS 证据与有界模型不能替代 Windows 验收，也不能证明网络文件系统时延。
