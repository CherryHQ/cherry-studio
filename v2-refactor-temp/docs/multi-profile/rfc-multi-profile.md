# RFC: 多 Profile 基础架构

- 状态：草案（Draft）
- 作者：（待填）
- 日期：2026-06-26
- 相关代码：`src/main/index.ts`、`src/main/core/paths/`、`src/main/data/db/DbService.ts`、`src/main/core/lifecycle/`、`src/main/core/job/JobManager.ts`、`src/main/data/CacheService.ts`、`src/renderer/data/`

## 1. 摘要

在 v2 引入 **profile**：同一 App 实例内可并存多个完全隔离的本地 profile，每个 profile 是一套独立的本地数据（会话、助手、知识库、文件、设置），同一时刻激活一个，可在运行时切换、无需重启 App。核心机制是把"当前 profile"建模成一次**激活**——持有 profile 资源的服务在 `onProfileActivate` 绑定、`onProfileDeactivate` 释放；开机是第一次激活，切换是 deactivate 旧的、activate 新的。本 RFC 只覆盖数据 / 运行时层的地基；账号、同步等上层能力不在范围内。

## 2. 动机

用户需要在同一 App 内维护多套互不可见的本地环境：工作与个人分开、为试验保留干净环境、共享机器上的隐私隔离、为不同场景各存一套配置（不同 Provider / 助手 / 知识库）。

现状无法做到这一点而不重启：v2 在预启动阶段把数据根（SQLite 库、`Data/` 目录）一次性确定并冻结路径表（`src/main/index.ts`）。其中 `app.setPath('userData')` 按 Electron 设计只能在 `app.ready()` 前调用一次。因此"换一套数据"等价于换数据根，目前只能通过重启进程实现。

目标是让当前激活的 profile 在运行时可切换、无需重启。心智模型是账号 / 工作区切换（如飞书 / Telegram 切换账号、Slack 切 workspace）：同一时刻聚焦一个，切换时整个 App 重新对准被激活的 profile，无需重启。

## 3. 指南级说明

一个 **profile** 是一套隔离的本地数据（会话、助手、知识库、文件、设置），对应磁盘上一个独立目录与一个独立 SQLite 库。任意时刻有且仅有一个激活 profile；切换 profile 即让整个 App 重新对准另一个 profile。

### 对功能开发者透明

profile 只存在于基础设施层。功能开发者无需感知它，沿用既有数据访问方式即可拿到当前激活 profile 的数据：

- 渲染层：`useQuery('/topics')`、`usePreference('ui.theme_mode')` —— 返回当前 profile 的数据；
- 主进程服务层：经 `application.get('DbService')` 访问库 —— 落在当前 profile 的库；
- 路径：`application.getPath('feature.files.data')` —— 解析到当前 profile 的目录。

业务代码不传 profileId、不写 `where profile_id = …`。**只有少数服务需要感知切换**——持有 per-profile 句柄 / 缓存 / 在途工作的服务（含 `DbService`、`PreferenceService` 等，见 §4.2）；纯读库、不缓存、不持句柄的业务服务（`TopicService` 等）透明——DB 一换，它们下次调用自动落到新库。

### 什么随 profile，什么全局共享

- 随 profile：业务数据（DataApi 表）、用户设置（`preference` 表）、`Data/` 下的文件 / 笔记 / 知识库、Claude Code 会话与外部服务凭据。
- 全局共享（不随切换）：BootConfig（`~/.cherrystudio/boot-config.json`）、`~/.cherrystudio/` 下的工具安装、主进程可丢失状态（窗口几何，`electron-window-state` 存 `{userData}/window-state.json`）。

### 切换

`ProfileService.switchProfile(id)` 是切换入口。切换在提交点生效，全程无 App 重启；主窗口会 `reload` 一次（约几百毫秒）。

## 4. 参考级说明

### 4.1 路径分层：app 级冻结路径 vs 可变的当前 profile 根

`userData` 在预启动设定一次后保持恒定。profile 不通过 Electron 的 `userData` 机制实现——`setPath('userData')` 只能在 `app.ready()` 前调用一次、无法在运行时切换——而是在恒定的 `userData` 之下，由应用层把每个 profile 解析为一个子目录。这是"不重启"的地基，与切换机制正交。

```
{userData}/
├── window-state.json 等 app 级可丢失状态
├── Profiles/<id>/
│   ├── cherrystudio.sqlite
│   └── Data/ { Files, Notes, KnowledgeBase, Agents, Skills, Channels, Workspace }
└── (legacy 根，作为默认 profile，见 4.7)

~/.cherrystudio/  （app 级，跨 profile 共享）：boot-config.json、profiles.json（注册表，见 4.6）、二进制 / 模型安装；per-profile 内容按 4.1 判据重定位到 profile 根
```

把 `buildPathRegistry()` 拆为 `buildAppPathRegistry()`（app 级键，`Object.freeze`、预启动一次）与 `buildProfilePathRegistry(profileRoot)`（profile 级键，切换时重建，存入由 `ProfileService` 持有的可变槽位）。`application.getPath(key)` 按键的分类路由；分类只在一处声明（独立文件的 predicate / key 集合），两个 builder + 路由三处派生。约束：profile 级键沿用既有命名空间、不新增顶层命名空间（`cherry/sys/app/feature/external` 封闭集）；`pathRegistry.ts` 文件级 ESLint 要求注册表外无对象字面量，故分类源置于独立文件；未选定 profile 时对 profile 级键抛错，不做兜底。profile 根每次切换只算一次传入 builder，不在每次 `getPath` 里条件判断。

分类穷尽且封闭：每个 key 非 app 级即 profile 级，无第三桶（profile 为扁平隔离对等体，不存在"跨部分 profile"的落点）。判据按**内容**——装 per-profile 用户内容的 key 归 profile 级，其余 app 级；归 app 级即断言"该 key 不含 per-profile 用户内容"。位置可作速判（`userData/Data/` 子树 + `app.database.file` → profile；装二进制 / 下载模型 / 窗口几何 等无用户内容者 → app），但**内容优先于位置**：反直觉项如 AI trace（span 存 `inputs` / `outputs`）、per-identity 凭据（Copilot token、MCP OAuth）、MCP memory，内容为 per-profile，虽历史落点在 `~/.cherrystudio` 共享目录，仍归 profile 级、随 profile 重定位。

集合即契约（同 §4.2）：由代码 + 测试锁定、非文档名单——测试强制每个 key 带 `app | profile` 标记、`app` 标记者断言不含 per-profile 用户内容；逐 key 归桶落实现，由该测试兜底。

### 4.2 profile 激活契约（核心）

把"当前 profile"建模成一次**激活**。定义**专用接口** `ProfileActivatable`：`onProfileActivate(ctx)` / `onProfileDeactivate(ctx)`，实现模式沿用 lifecycle 的 `Activatable`（可反复触发、被 await、deactivate 时释放，且不影响 `onInit` 注册的 IPC）；为独立接口、不复用 `Activatable` 本身——`Activatable` 是"功能 / 重资源按需启停"轴，与"profile 资源绑定"正交（理由见 §6）。

**实现 `ProfileActivatable` 的服务**——持有 per-profile 句柄 / 缓存 / 在途工作的：

- `DbService`（库连接）、`PreferenceService`（**内存 cache**——`onInit` 从库读 preference 表、`get()` 走 cache，切换不重载就串旧 profile 设置）、`KnowledgeVectorStoreService`（每库向量索引句柄）、`DirectoryWatcher`、`AiStreamManager`（按 topic 持流）、`AgentSessionRuntimeService`、`JobManager` + `SchedulerService`（dispatch / recovery / 在途 job）、文件搜索索引、`ProviderRegistryService` 的 `RegistryLoader` 缓存、`McpRuntimeService` / `McpCatalogService`（读 per-profile `mcpServerService` + `feature.mcp.oauth`）。

**不实现的**：纯读库、不缓存、不持句柄的业务服务（`src/main/data/services/*` 大多数）透明随 DB 切换；注册 job handler 的 feature 服务（`FileProcessingService`、`KnowledgeService`、`AiService`、`AgentJobsService`）其 handler 保持 profile-agnostic（见下），故不实现本接口。`CommandService` 的 `registerHandler` 是命令注册表、其命令为 app / window 级，归 app 全局。

- **资源放哪**：`onInit`（一次）注册与 profile 无关的 IPC、静态设施；`onProfileActivate(ctx)` 绑定该 profile 的资源（DbService 开库；PreferenceService 从新库重载 cache——其读库从 `onInit` 移到此处、排在 DbService 之后；owner 开句柄；watcher 指新根）；`onProfileDeactivate(ctx)` 释放（abort 在途、关句柄、关库、清 cache）。
- **job handler 保持 profile-agnostic**：handler 在 `onInit` 注册一次、dispatch 时经 `DbService` / `getPath` 现取数据，`JobManager` 切换不清 handler map，故注册者不实现本接口、handler 自动读新库。约束：handler 不得在注册时闭包 profile 状态。
- **恢复 / arming**：profile 相关恢复（`JobManager` startup recovery、`KnowledgeService` 中断项恢复）现在 `onAllReady`（每进程一次）；改为**全部激活后统一编排一次**（`ProfileService` await activate-all 后逐个调各参与者的 recover），开机与切换同一路径。
- **集合即契约**：由代码 + 测试锁定，非文档清单；确切名单需一次审计（依赖图看不到运行时 `application.get('DbService')` 的访问者，见 §8）。

app 全局服务不实现该接口、切换时保持运行：`WindowManager`、`IpcApiService`、`CacheService`、`CommandService`、Tray/Menu/Shortcut、`BinaryManager`、Updater 等。`CacheService` 归 app 全局（拥有 cache IPC handlers、跨窗口 shared 层；主进程无 persist 层）；其 memory/shared 若有 per-profile 派生项（loseable），切换时按 key 清即可。

### 4.3 DbService（库 owner）

当前连接在构造函数打开（`DbService.ts:50` 起）、无 `close()`。改为实现 `ProfileActivatable`：`onProfileActivate` 读当前 profile 根下的 `app.database.file`、打开 better-sqlite3 连接 + 配 pragma + migrate + seed；`onProfileDeactivate` 同步 `close()`（better-sqlite3 单连接、无写互斥可排空，close 即落盘 WAL、释放句柄）。每个 profile 的库独立 migrate + seed；新 profile 是全新库，会按其自身 `app_state` 种子日志完整 seed，但"仅首装运行"的 bootstrap-only seeder 会各 profile 各跑一次，须保证幂等或把标记提到 app 级。

### 4.4 切换时序

`ProfileService.switchProfile(targetId)`。磁盘 `activeProfileId` 只在提交（步骤 5）成功后更新，故始终指向"最后稳定 profile"；中途失败或崩溃，下次预启动仍回原 profile。activate / deactivate 的顺序由 `ProfileService` 的 participant resolver 决定并受测：deactivate 时 writers / stream / job / watcher 先、`DbService` 最后；activate 时 `DbService` 先、依赖 DB 的后。

```
1. 标记"切换中"（UI 全局阻塞）、拒绝并发切换。切换期间对 profile 级访问（getDb() / DataApi / profile IPC）返回明确的"profile 切换中 / inactive"错误，而非半初始化状态。
2. deactivate 全部（倒序）：各 onProfileDeactivate 自行排空在途工作 + 释放——AiStreamManager abort 流、JobManager 等 running job settle（复用其 onStop 的 settle-with-timeout；settle 超时按步骤 2 失败处理、见下）、DbService 最后 close（同步）。倒序保证"写者先停、库后关"，在途写者不越过切换写到已关 / 错误的库。
3. 路径表槽位重指向 target。
4. activate 全部（正序）：DbService 开新库、Preference 重载 cache、各 owner 重建句柄（handler 已在 onInit 注册、profile-agnostic，无需重注册）；全部激活后统一编排 recovery / arming（await）。
5. 提交：持久化 activeProfileId=target 到 profiles.json。至此 profile 已切换。
6. renderer 重置（见 4.5）。
7. onProfileDidSwitch.fire(target)：仅通知（fire-and-forget，吞错、不 await）；清"切换中"。
```

**原子性**：提交点（步骤 5）之后视为已切换；提交前失败按所处阶段分两支回滚，均报 switch failed，磁盘指针只在步骤 5 成功后动、回滚后仍原 profile：

- **旧 profile deactivate 阶段（步骤 2，含 settle 超时）失败**：不前进（不切 target、不 close 旧库、不 activate 新库），重新 activate 已 deactivate 的旧 profile participants。超时时因 `DbService` 最后才 close、旧库仍开，未 settle 的写者继续写向仍激活的原 profile、无损。
- **target activate 阶段（步骤 4）失败**：按已激活集合逆序 deactivate 已激活的 target participants、槽位指回旧 profile、重新 activate 旧 profile。

若回滚本身也失败（旧 profile re-activate 亦失败）→ 进入 fatal 路径：提示用户重启 / relaunch。

**提交后（步骤 6–7）**：profile 已提交，renderer reset 失败**不再回滚 profile**——按需重试 reload、重开主窗口，或提示用户重启。

失败模式 —— 在途写者越过 settle：job handler 与 AI 流的持久化监听会持续同步写库，而 `cancelMany` 明确不等待 running handler；故步骤 2 每个 `onProfileDeactivate` 须先 abort、再等 running settle 成功（超时即步骤 2 失败、走回滚、不 close；见原子性），DbService 最后 close。better-sqlite3 单同步连接、无写互斥。

### 4.5 Renderer 重置

切换时关闭除主窗口外所有窗口（池化类型 `suspendPool`），只 `reload` 主窗口；次级 / 弹出 / 池化窗口本就按需打开，下次以新 profile 重新开。对池化窗口（`SubWindow` / `SelectionAction`）"关闭"比"reload"简单，规避 reload 破坏池化复用契约的风险。主窗口 reload 后需：清 `initDataStore` 与 `usePersistCache` 的 localStorage（`cs_cache_persist`，reload 不清）、重注入动态选项（主题色 / zoom；窗口位置由 `windowStateKeeper`（electron-window-state）自动恢复）。`reload` 一次性清空主窗口内存态（SWR / Preference / Cache / Redux）。

### 4.6 Profile 注册表与激活指针

注册表须预启动可读（DbService 很早就要据当前 profile 解析库路径），存于 `~/.cherrystudio/profiles.json`：

```json
{ "activeProfileId": "default",
  "profiles": [ { "id": "default", "name": "默认", "dataDir": "default", "createdAt": 0 } ] }
```

预启动读 `activeProfileId` → 算 profile 根 → 建首屏 profile 路径表 → 激活 profile 作用域服务（= 开机的第一次激活）。`ProfileService` 运行时增删 profile、切换、持久化，置于 `core/profile/`。`id` 用不可变的 8 位 base62 `nanoid`（`customAlphabet('0-9A-Za-z', 8)`，无前缀；创建时对注册表查重、撞则重生成），`name` 面向用户可改。默认 profile 用保留 id `default`（不经生成器，长度与生成 id 不同、绝不相撞）。新 profile 的 `dataDir` = `Profiles/{id}/`；默认 profile 的 `dataDir` 为保留值，解析到旧根（见 4.7）。

### 4.7 既有用户迁移

现存数据在 `userData/cherrystudio.sqlite` 与 `userData/Data/`（旧根）。采用**默认 profile 显式映射旧根**（`default.dataDir` 指向旧根，不移动文件）：零迁移、风险最低。（per-profile 化的凭据 §4.1 对默认 profile 需从 `~/.cherrystudio` 迁到旧根或从旧位置读，迁移时处理。）结构统一留到后续。

## 5. 缺点

- 每个 `ProfileActivatable` 服务都要正确实现 `onProfileActivate` / `onProfileDeactivate`——漏释放一项就句柄泄漏或串到旧 profile。集合是"真实消费 per-profile 资源"的 owner（含 `PreferenceService` 的 cache）；靠 §8 的审计 + 测试兜底。
- job handler 须保持 profile-agnostic（dispatch 时现取），否则跨 profile 串数据；这是编码约束、非机制强制。
- 切换有代价：deactivate/activate + 主窗口 reload = 一段 UI 阻塞窗口。
- 开机流程改变：初始激活在 `onInit` 之后。
- 每 profile 一个库会成倍增加磁盘占用，且各 profile 各自 seed。

## 6. 理由与替代方案

### 隔离粒度：行级 / schema 级 / 库级

多租户隔离三档，本设计选**库级**（每 profile 独立 SQLite 文件）。**行级判别**（每表加 `scope`/`profileId` 列）是服务端 RLS 的本地对应，但 SQLite 无原生行级安全，只能应用层每查询 `where` 过滤、漏一处即泄漏；`preference` 表已有 reserved 的 `scope` 列，此方案可复用它，但破坏开发者透明、所有 profile 混在一个文件（隔离弱）。**Schema 级**（SQLite 下 = `ATTACH` 多库文件）会破坏透明、Drizzle 不原生支持、对"同时只一个"无实质优势。**库级**给完全物理隔离 + 透明访问，任意时刻只开一个库；`scope` 列保持原样、可留作单 profile 内分区，两者可组合。

### 激活模型 vs stop/start 子树

另一种做法是用 `application.stop/start` 重启 profile 子树。但 stop/start 复用开机语义（`onInit` / `onReady` / `onAllReady` 每进程一次、注册假设单次生命周期），与"每次激活 profile 都重跑"不符：`onAllReady` 只触发一次、注册单次生命周期、`fire` 不 await——恢复 / 重注册 / barrier 需逐个服务额外适配。激活契约（`onProfileActivate` / `onProfileDeactivate`）可反复触发、被 await、释放对称，恢复 / 注册 / 释放归于同一接口，开机 = 第一次激活（与切换同路径），且只有需要感知 profile 的服务实现它。用独立接口 `ProfileActivatable`（复用 `Activatable` 的实现模式）而非 `Activatable` 本身，避免与功能启停轴重叠。

### 其它替代

- 每 profile 重绑 Electron `userData`：`setPath` 只能预启动一次，切换必重启，与目标冲突，否决。
- 渲染层做精确缓存失效而非整窗 reload：缓存层分散、易漏易竞态，作为后续优化，不在 MVP。
- 整进程 `relaunch`：能一次性消除全部切换复杂度，但它是重启，违背"不重启"目标。

### 不做（或推迟）的影响

- 用户层面：有分隔需求的用户在 App 内无解，只能退到笨重绕法（另开系统账号 / 手动改数据目录并重启 / 装多份），否则工作与个人长期混在一处。
- 架构层面，推迟的代价随时间上升：当前"单一固定数据根、路径表冻结"的假设会随 v2 持续固化——越多服务运行时访问库、越多路径焊进冻结注册表、越多单例假设只有一个库。每多一个不感知 profile 的功能，日后 profile 化就多一处要改。趁 v2 收口期引入接缝成本更低。

## 7. 先例

运行时在隔离的账号 / 工作区 / profile 间切换、无需重启，是常见的成熟模式。Slack / Notion 切 workspace、飞书 / Telegram / Discord 切账号都是如此：切换时整个 App 重新对准另一份隔离数据。本设计与它们基本一致，区别在其数据多在服务端、且常同时登录多个，而本设计在本地、严格同一时刻只一个。

`profile` 一词及"一份隔离的本地数据、可有多份"的概念沿用 Firefox / Thunderbird **profile**、Obsidian **vault**、Apple Photos / Music **library**（它们切换多靠重启或多实例，与本设计的运行时切换不同，但概念一致）。与 Chrome 不同：Chrome 是并发、一窗一 profile，本设计严格同一时刻一个；VS Code profile 只隔离设置 / 扩展，不隔离数据。

命名：采用 `profile`（`workspace` 已被 agentWorkspace 占用、`vault` 已被 Obsidian 集成占用，均不宜复用；`profile` 的概念槽位在代码库空闲）。

## 8. 未决问题

待实现阶段确定：

- **确认并锁定激活契约集合**：§4.2 已列出已知实现者；因依赖图看不到运行时 `application.get('DbService')` / 路径访问者，须一次系统审计（`getDependents` + 全仓搜索运行时访问者）确认这批无遗漏，并把集合落为代码模块 + 测试（非文档清单）。
- **确认 key 分类穷尽且无误**：实现时对全部 path key 逐一套 §4.1 判据，由"每个 key 带 `app | profile` 标记、`app` 标记断言不含 per-profile 用户内容"的测试确认无 app 级 key 漏含 per-profile 内容（trace / 凭据 / MCP memory 这类落点在共享目录者尤需核对）。

## 9. 未来可能

仅说明方向，不作为本 RFC 的接受理由：

- profile 可作为后续"账号 / 身份绑定""跨设备同步"等能力的绑定基底；这些作为独立上层叠加，不在本 RFC。
- DataApi 的统一接缝使一个 profile 的数据源未来可在本地与远程之间选择；本 RFC 仅做本地。
