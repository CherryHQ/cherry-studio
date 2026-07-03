# 多 Profile 基础架构设计

意图与决策见 [RFC](./rfc-multi-profile.md)。本文件定义各机制的状态、时序与失败行为。

## 1. 总览

一个 profile 是一份隔离的数据：独立 SQLite 库与 Data 目录。切换 profile 不重启进程。切换时每个持有 per-profile 资源的服务从旧 profile 的资源转移到新 profile 的资源（§6、§8）；路径、注册表、profile 根（§2–§4）提供 profile 到磁盘位置的映射。

## 2. 路径模型

路径 key 分两类：app 级跨 profile 恒定，profile 级随当前 profile 变。`PROFILE_PATH_KEYS` 列出全部 profile 级 key，其余为 app 级；`isProfilePathKey(key)` 据此判别。

两张表：

- `appMap`：`buildAppPathRegistry()` 于 boot 构造并冻结，此后不变。
- `profileSlot`：`buildProfilePathRegistry(roots)` 按当前 profile 根构造，切换时（§8 步骤 3）整体替换。

解析：`getPath(key) = isProfilePathKey(key) ? profileSlot.get(key) : appMap.get(key)`。

不变量：`profileSlot` 在任何 profile 级路径解析之前安装（预启动，§5）；app 级路径不依赖 profile。

## 3. Profile 注册表与激活指针

```ts
type ProfileEntry = { readonly id: string; readonly name: string; readonly dataDir: string; readonly createdAt: number }
type ProfileRegistry = { readonly version: number; readonly activeProfileId: string; readonly profiles: readonly ProfileEntry[] }
```

落盘于 `~/.cherrystudio/profiles.json`。自管文件而非并入 BootConfig，理由有三：a) **损坏爆炸半径**——BootConfig 解析失败时整文件回默认，且它托管着启动关键的 `app.user_data_path`，共存意味着一次坏写同时丢 profile 列表与 userData 指针；注册表需要的是逐条校验、坏条目不连累好条目；b) **写频解耦**——profile CRUD（含两阶段删除）是高频变更写，不该落在最写敏感的启动文件上；c) **数据性质**——BootConfig 是设置 KV（差异存储、去默认值、防抖），注册表是带版本号与崩溃安全删除的实体集合，归 `ProfileService` 所有。`activeProfileId` 与列表同文件共存（不拆入 BootConfig），保住 §8 步骤 5 的单文件原子提交。

- 注册表带 `version` 字段（当前 1），缺失按 1 兼容——结构必然演化（avatar / lastUsedAt 等），版本号先行。
- `id`：8 位 base62 `nanoid`（`customAlphabet(BASE62, 8)`，`BASE62` 为 62 字符字面字母表——`customAlphabet` 不解析 `'0-9A-Za-z'` 这类范围写法；无前缀），不可变；`addProfile` 生成时对现有 id 查重、撞则重生成。默认 profile 保留 id `default`（不经生成器）。命名：`name` 允许重名（id 唯一标识）；默认 profile 可改名（`name` 仅为 label，id 恒为 `default`）。
- 变换：`addProfile / renameProfile / setActive : ProfileRegistry -> ProfileRegistry`；`findEntry(reg, id)`。
- 读写：`readProfileRegistry()` 逐条校验 entry——坏条目丢弃并记 error 日志，不连累合法条目；文件缺失（全新安装的正常路径）回落仅含默认 profile 的注册表并记 info；存在但不可解析同样回落，记 error（不静默）。`writeProfileRegistry(reg)` 经临时文件 + rename 原子写。
- `readProfileRegistry` 的返回值中 `activeProfileId` 必指向存在的 entry（校验不过则回落默认），下游不再判空。
- boot 期经 `resolveBootProfile()` 记忆化，全 boot 只读一次盘。

## 4. Profile 根与迁移

```ts
type ProfileRoots = { readonly profileRoot: string; readonly credentialRoot: string }
resolveProfileRoots(entry): ProfileRoots
```

- 默认 profile：根为 legacy 位置（原 userData / Data 目录），既有用户就地读旧数据，不搬运。
- 非默认 profile：根为 `Profiles/<id>/` 下的隔离子目录。
- 凭据：默认 profile 读 legacy 凭据位置，新 profile 隔离在其 `credentialRoot`。

不变量：`resolveProfileRoots(默认 profile)` 恒返回 legacy 根，且不复制既有数据。

## 5. Boot 时序

boot 是对 boot profile 的首次激活，随参与者按阶段就绪分步进行；绑定从 `unbound` 到 `bound(bootProfile)`。两个步骤：

**预启动（路径解析之前）**：`resolveBootProfile()` 定身份 → `resolveProfileRoots` → 安装 `profileSlot`；早于 `initPathRegistry()`，故后者只建 `appMap`。

**bootstrap 激活（两段）**：`getProfileParticipants()` 只列已进入 `initializationOrder` 的参与者，该序按阶段追加，故分两段：

1. Tier-1：BeforeReady 阶段后激活 BeforeReady 参与者（`DbService`、`PreferenceService`）。
2. Tier-2：WhenReady 阶段后、background join 前激活 WhenReady 参与者。

不变量：`DbService` 在 Tier-1 激活，早于 WhenReady 的开窗（`MainWindowService` 在 WhenReady `onReady` 开窗），主窗口首帧的数据读取命中已开的库。

boot 期两段激活任一失败均包装为 `ServiceInitError`，走致命启动路径（"Unable to Start" 对话框，Exit/Restart）——不得裸 `exit(1)`：库打不开 / 迁移失败是用户可见的启动失败，须给出对话框而非静默退出。

## 6. 激活模型

服务的激活态：

```ts
type ProfileBinding =
  | { readonly kind: 'unbound' }
  | { readonly kind: 'bound'; readonly profileId: string }
```

该类型无法表示"bound 但无 profileId"或"unbound 但残留 profileId"；一个服务至多绑一个 profile。

决策函数据当前 binding 与目标决定动作：

```ts
type ActivationEffect = 'none' | 'acquire' | 'release-then-acquire' | 'release'

function decideActivate(binding: ProfileBinding, target: string): ActivationEffect {
  if (binding.kind === 'unbound') return 'acquire'
  if (binding.profileId === target) return 'none'
  return 'release-then-acquire'
}
function decideDeactivate(binding: ProfileBinding): ActivationEffect {
  return binding.kind === 'bound' ? 'release' : 'none'
}
```

`BaseService` 据决策调用服务 hook 并更新 binding：

| effect | 动作 | 结束态 |
|---|---|---|
| `none` | 无 | 不变 |
| `acquire` | `onProfileActivate(target)` | `bound(target)` |
| `release-then-acquire` | `onProfileDeactivate(old)` → `onProfileActivate(target)` | `bound(target)` |
| `release` | `onProfileDeactivate(current)` | `unbound` |

`activate(P)` 成功返回后 binding = `bound(P)`，与调用前状态无关。

错误契约（同 `Activatable`）：hook 抛出前须释放已获取的资源。`onProfileActivate` 抛出时 binding 停 `unbound`；`onProfileDeactivate` 抛出时 binding 置 `unbound`；错误均上抛。`unbound` 表示不持有任何 profile 的资源，后续 `acquire` 干净重取。

## 7. DbService

```ts
type DbConnection =
  | { readonly kind: 'closed' }
  | { readonly kind: 'open'; readonly sqlite: Database; readonly db: DbType }
```

（`Database` 为 better-sqlite3 实例，`db` 为其上的 drizzle 句柄。）该类型无法表示"有 drizzle 句柄而底层连接已关"。

- `onProfileActivate`：`closed` → `new Database(file)` → 配 pragma → migrate → seed → `open`；任一步失败则 close、回 `closed`、上抛。
- `onProfileDeactivate`：`sqlite.close()`（同步，落盘 WAL、释放句柄）→ `closed`。
- `getDb()` / `withWriteTx()`：`closed` 时抛 "not active"。better-sqlite3 单同步连接：`withWriteTx` 同步返回、包 `db.transaction(fn, { behavior: 'immediate' })`，`fn` 必须同步（不得 await）；无进程级写互斥。

不变量：`DbService` 激活序最先、停用序最后（它是其它 profile 服务的依赖，容器 `initializationOrder` 保证）；关库前写者已 abort / settle——写者的 `onProfileDeactivate` 可能做最后一次同步写，故关库前须先停。

## 8. 切换编排

`ProfileService.switchProfile(target)`：

1. 置切换中；拒绝并发切换。
2. `deactivate-all`（逆依赖序：writers 先，`DbService` 最后；stop-on-throw）；段末对旧 profile 的 webview 分区 session 与 default session 执行 `flushStorageData()` + `cookies.flushStore()`——DOMStorage 落盘是异步的，flush 保证其后无论走正常切换、回滚还是 relaunch 兜底，最近写入均已在盘上。
3. `profileSlot` 重指向 target 根（§2）。
4. (4a) `activate-all`（正依赖序：`DbService` 先）；(4b) 随后统一 recovery（job / knowledge 等重挂）。
5. 提交：`writeProfileRegistry(setActive(reg, target))`（磁盘 `activeProfileId` 仅此步改）。
6. renderer 重置（§9）。
7. `fire(onProfileDidSwitch)`；清切换中。

逆序 deactivate 保证写者在 `DbService` 关库前释放，在途写者不写向正在关闭的库。

**回滚**：提交（步骤 5）前任一阶段失败，先 `deactivate-all`（逆序）释放 target，再重指 previous 根、`activate-all(previous)`、统一 recovery（与正向切换的步骤 4b 对称——deactivate 已 dispose 掉 previous 的调度，不重挂则其周期任务静默停摆）。必须先逆序释放而不能只靠 `activate-all` 的 `release-then-acquire` 收敛：后者按激活序执行、`DbService` 最先，会先关 target 库再重开 previous 库，此时仍绑 target 的写者（如 recovery 已派发的 job）尚未释放，其落盘会写入已重开的 previous 库。由 §6 收敛性，各参与者无论处于何绑定态均回到 `bound(previous)`。**回滚自身失败升级为 `app.relaunch()` 直入目标 profile（先 flush，再走 `shutdown()`）——进程重启是本设计的可靠性下限：最坏情形退化为重启式切换，热路径是该下限之上的优化，而非替代。** 提交后失败（步骤 6–7）不回滚 profile，记录并按需重试。

## 9. Renderer 重置：源头隔离

原则：**切换路径上不清除任何存储**——每个 profile 的 Chromium 侧数据在源头即已隔离，切换只是让窗口对准另一份。（不用 `clearStorageData`：它会毁掉用户需要保留的数据，且对 LevelDB 后端的 localStorage / IndexedDB 是文档级不可靠的墓碑删除。）

窗口编排：关闭全部非主窗口（pooled 类型先 `suspendPool` 排空 standby，再关在用实例，重置完成后成对恢复，否则池化契约在首次切换后永久失效；singleton 直接关；retention 保活的隐藏窗口销毁而非隐藏，避免旧 profile 的活 renderer 幸存）；**主窗口不销毁，仅 reload**。切换提交后 renderer 内存态（SWR / Preference / Cache）随 reload 重读新 profile。

两个存储群体，两种机制：

- **webview 分区（第三方登录态：小程序 webview、provider OAuth 弹窗）——按 profile 命名，物理隔离。** 分区不可变约束的是活 WebContents 而非窗口；该分区的全部消费者随主窗口 reload 重建（`<webview>` guest 随页面销毁、重挂时携带新分区名）或每次新开（OAuth 弹窗在 window-open override 处开窗时取当前 profile 分区）。分区名 `persist:webview-<profileId>`；默认 profile 沿用 `persist:webview`（零迁移不变量）。分区 session 上的配置（`WebviewService` 的 UA 改写与 Accept-Language 头钩子、`ProxyService` 的代理）改为对当前 profile 分区应用、随 `onProfileActivate` 重设——两者因此进入 §10 名单。切走再切回，登录态原样恢复。
- **default session（app 窗口自身的 web 存储）——不搬迁，按 key 命名空间隔离。** 运行时无法给活窗口换 session，也不需要：v2 渲染层不持业务数据，default session 的唯一许可用途是 CacheService persist 层，key 由 `cs_cache_persist` 改为 `cs_cache_persist:<profileId>`——各 profile 的 UI 状态各自存活、切回即恢复（「允许丢」不等于「切换必丢」）。物理同库的残留属 §4 威胁模型（命名空间隔离，非安全边界）。

shared cache 的 per-profile 派生键仍由各 owner 在 `onProfileDeactivate` 清理（如 `jobs.state.`、`topic.stream.`）。

强制手段（防漂移，一次性工作项）：清点渲染层现存的直接 web 存储使用——v1 残留（Dexie 库、`persist:cherry-studio` 等）走既有删除名单，凭据形内容迁往主进程存储，其余逐点归类共享 / 命名空间化；随后以 lint 规则限定渲染层 web 存储访问仅经 CacheService。

## 10. 服务分类

`ProfileActivatable`（持有 per-profile 资源的 owner）：`DbService`、`PreferenceService`、`KnowledgeVectorStoreService`、`DirectoryTreeManager`、`AiStreamManager`、`AgentSessionRuntimeService`、`JobManager`、`McpRuntimeService`、`McpCatalogService`、`ChannelManager`、`TraceStorageService`、`ApiGatewayService`、`WebviewService` 与 `ProxyService`（per-profile 资源 = 当前 profile 分区 session 上的 UA / 头钩子 / 代理配置，§9）。

共享基建不实现（跨 profile 全局）：`SchedulerService`、`CacheService`。`SchedulerService` 上的 per-profile 调度由 `JobManager` 在其 `onProfileDeactivate` dispose；`CacheService` 的 per-profile 派生项由各 owner 按前缀清（§9）。判据：状态是否随 profile 变而必须换。名单为当前核对结果，实现期按判据对全注册表复核（待核候选：`ClaudeCodeWarmQueryManager` 的暖查询进程、`OpenClawService` 的 gateway 进程、`CherryInOauthService` 的凭据缓存）。

## 11. 不变量与强制手段

| 不变量 | 强制手段 |
|---|---|
| 路径 key 属于且仅属于 app / profile 之一 | 类型 + `isProfilePathKey`；测试断言 `PROFILE_PATH_KEYS` 之外皆 app |
| app 级路径跨切换恒定 | `appMap` 冻结，切换只换 `profileSlot`；测试断言切换前后 app 路径不变 |
| 路径解析先于任何 profile 数据访问 | 预启动在 `initPathRegistry` 前装 `profileSlot` |
| `profiles.json` 的 `activeProfileId` 必指向存在 entry | `readProfileRegistry` 校验期回落默认；测试注入损坏文件 |
| 默认 profile 零迁移、就地读 legacy | 测试：`resolveProfileRoots(默认)` 返回 legacy 根 |
| `DbService` 在主窗口开前已激活 | Tier-1（BeforeReady 后）早于 WhenReady 开窗；测试断言激活序 |
| 任一服务至多绑一个 profile | 类型：`ProfileBinding` |
| `activate(P)` 成功后 `binding=bound(P)`，幂等/收敛 | 测试：`decideActivate` 全组合 + 解释器断言 |
| 抛错后 `binding` 落在 §6 规定态 | 测试：注入抛错 hook 断言 `binding` |
| DB 连接无"有 drizzle 句柄而连接已关" | 类型：`DbConnection` |
| 写者在 `DbService` 关库前 abort / settle | 依赖序（`DbService` 停用序最后）；测试断言停用序 |
| 磁盘 `activeProfileId` 仅步骤 5 后改 | 测试：步骤 2 / 4 注入失败，断言 `profiles.json` 未变、运行时回 previous |
| boot 激活失败走致命对话框，不裸退出 | bootstrap 将激活异常包装为 `ServiceInitError`（§5） |
| 回滚先逆序释放 target，再取 previous | `rollbackTo` 先 `deactivateProfile()`；测试断言调用序（§8） |
| webview 分区名由当前 profile 决定，默认 profile 沿用 legacy 名 | 分区名统一经单点函数解析；测试断言映射（含默认 profile） |
| 切换路径零清除（不调 `clearStorageData`） | §9 源头隔离；代码审查 + 测试断言切回后旧 profile 数据仍在 |
| renderer web 存储访问仅经 CacheService | lint 规则（§9 强制手段） |
| deactivate 段 flush 先于任何 relaunch / exit | 测试断言调用序（§8 步骤 2） |
| 切换窗口内 profile 级访问报错，不静默返回默认值 | `DbService` closed 抛错 + `PreferenceService` 切换期守卫；统一方案见 §14 |
| profile 期启动（连接 / reconcile / recovery）只在 `onProfileActivate`，不得同时在 `onReady` | 约定 + 测试（违者 boot 双启动——boot 即首次激活） |

## 12. 测试

- 决策与解析函数：`isProfilePathKey`、`build*PathRegistry`、注册表变换、`resolveProfileRoots`、`decideActivate` / `decideDeactivate`——覆盖输入组合。
- 解释器：`BaseService` 激活 / 停用的 binding 转移，含抛错分支与收敛。
- `DbService` 真库集成：开库、迁移、seed、关库、换库隔离；`withWriteTx` 同步事务原子性（`setupTestDatabase`）。
- 注册表持久化：原子写、损坏文件回落、boot 单次读。
- 切换与回滚：步骤 2 / 4 各失败点注入，断言回滚回到 previous、`profiles.json` 未提交、无跨 profile 串数据。
- boot 两段激活：断言 Tier-1 / Tier-2 激活序与 `DbService` 先于开窗。
- 源头隔离：分区名映射（含默认 profile legacy 名）、persist key 命名空间化读写、注册表驱动的孤儿 key GC（§13.1）。

## 13. Profile 管理

Profile 的增删改查与切换面向用户：主进程 `ProfileService`（create / list / rename / delete / switch / isSwitching）、IPC 接口、以及一个仅供实机验证的临时切换器（一次性脚手架，不进主干）。

### 13.1 deleteProfile

```ts
deleteProfile(id: string): Promise<void>
```

守卫（拒绝并抛错，不静默）：删激活 profile（须先切走）、删默认 profile（legacy 数据落点，不可删）、删不存在的 id。

步骤（崩溃安全）：

1. 注册表将 entry 标记 tombstone 并落盘（两阶段第一步——崩溃后重启看到 tombstone 即知目录状态不确定，可安全重试清理）；
2. 删除磁盘数据（`rm -rf Profiles/<id>/`，不可逆；UI 二次确认后才进入本流程）；
3. 注册表移除 entry 落盘。

级联失效：删除时作废该 profile 的外部引用——gateway API key、渠道 bot 连接登记、pending 通知 / OAuth 事务（指向已删 profile 的回调按 §14.3 失配拒绝）。

Chromium 侧级联（两处存储群体各一，§9）：

- **分区目录**：墓碑期记录分区名，下次 preboot 无活 session 时物理删除 `Partitions/` 下对应目录（绕开 `clearStorageData` 对 LevelDB 的墓碑式不可靠删除）；
- **命名空间化 persist key**：注册表驱动 GC——renderer CacheService 启动时删除 id 不在注册表中的 `cs_cache_persist:<id>`（与分区目录的墓碑-preboot-删除同构，天然兜住删除中途崩溃）。

凭据若经 `safeStorage`：其加密边界是 OS 账户，profile 之间为命名空间隔离而非密钥隔离（与 §4 威胁模型一致）。

删非激活 profile 安全：只有激活 profile 的库被打开、目录被 owner 持有；非激活的 `Profiles/<id>/` 无任何句柄。

### 13.2 IPC：IpcApi profile 命名空间

profiles 存于 `profiles.json`、非 SQLite 表，走 IpcApi 不走 DataApi。`src/shared/ipc/schemas/profile.ts` + `src/main/ipc/handlers/profile.ts`，薄适配委托 `ProfileService`：

| route | input | output |
|---|---|---|
| `profile.list` | void | `{ activeProfileId, profiles }` |
| `profile.create` | `{ name }` | `ProfileEntry` |
| `profile.rename` | `{ id, name }` | void |
| `profile.delete` | `{ id }` | void |
| `profile.switch` | `{ id }` | void（切换期主窗口 reload，调用方不观察 resolve） |
| `profile.get_active` | void | `string` |

切换整窗 reload、重载后 renderer 重新 `profile.list`，不需要 switched 事件。

### 13.3 临时测试 UI（不提交）

侧边栏左下角竖排 profile 图标（当前高亮）+ `+`；点击切换、`+` 新建、右键改名 / 删除（二次确认）；切换中置灰。仅供实机验证；正式管理界面另行设计。

## 14. 切换期上下文围栏

"切换前启动的异步工作在切换后落盘"（straddle）的手写守卫须每个 owner 各自实现正确、对新增服务不自动生效；围栏取代之（14.6）。用 Node 内置 `AsyncLocalStorage`（ALS）给每段异步工作隐式携带"属于哪个 profile 世代"，在少数数据卡点强制比对——跨 profile 写从静默污染变为结构性报错，服务作者零标注。

**目标**：straddle 写落盘时响亮失败；切换窗口内数据访问统一报"切换中"（替代手写布尔）；对未来服务自动生效。**非目标**：不做 join（需落盘的 drain 保留原地，见 14.6）；不改 `application.get` 约定；非数学证明（ALS 有丢失点，见 14.7）。

### 14.1 模型

```ts
type ProfileGeneration = { readonly profileId: string; readonly generation: number } // 单调递增，进程内
type ProfileContextState = ProfileGeneration | { readonly kind: 'switching' }
```

`current` 由 ProfileService 推进（14.4）；ALS store 在入口打标一次后自动沿 await / promise / timer / microtask 传播——`setTimeout` 回调继承**创建时**上下文，正是围栏要的语义（泄漏的 timer 携带旧世代，卡点拒绝）。卡点判定：

| ALS store | current | 结果 |
|---|---|---|
| `{gen: N}` | `{gen: N}` | 放行 |
| `{gen: N}` | `{gen: M>N}` | 抛 `StaleProfileContextError` |
| 任意 | `switching` | 抛 `ProfileSwitchingError` |
| `undefined` | 任意 | 放行 + debug 日志（14.5） |

### 14.2 入口清单（打标点，全在基础设施）

| # | 入口 | 位置 |
|---|---|---|
| 1 | IpcApi 路由分发 | `IpcApiService` 的 `IpcApi_Request` 单点 |
| 2 | DataApi 请求 | `IpcAdapter` 的 `DataApi_Request/Subscribe/Unsubscribe` |
| 3 | 遗留 IPC | `BaseService.ipcHandle`/`ipcOn` |
| 4 | Scheduler 回调 | `SchedulerService` 的 Cron / setTimeout 回调调用处（显式打注册时上下文） |
| 5 | Profile 激活钩子 | `LifecycleManager`（deactivate 以旧世代打标——drain 落旧库合法；activate 以新世代） |
| 6 | 裸 `ipcMain.handle` 存量 | `wrapIpcHandler(fn)` 薄封装迁移，不 monkey-patch（存量约 130 处，集中于 `src/main/ipc.ts` 的 legacy 注册段，机械改动；预启动迁移窗口的 `MigrationIpcHandler` 显式豁免——profile 激活前 store 恒为 undefined，按 14.5 放行） |
| 7 | ApiGateway HTTP 路由 | 请求处理单点（HTTP 直调 profile 服务，与 IPC 同为外部入口） |
| 8 | 渠道入站事件 | ChannelAdapter 消息回调（socket 事件多能继承连接期上下文，内部 debounce 队列是丢失点，入口显式打标兜底） |

进程内 `Emitter` / microtask / promise 链不需打标——从触发方继承。

### 14.3 跨进程异步回调：载荷携带世代（ALS 传播不到）

系统通知点击、`cherry://` deeplink、OAuth 授权回调、second-instance argv 跨越 OS 边界——发起于 A、可能在 B 期间到达，ALS 无法跨进程传播。这类回调在**发起时**把 `{profileId, generation}` 写进载荷，到达时比对，失配 → 拒绝 + 日志。已知实例：MCP OAuth 回调（A 发起的授权在切换后完成会把 token 写进 B 的 `feature.mcp.oauth`；切换时还须作废 pending OAuth 事务）、系统通知（悬垂实体引用，失配忽略或提示切换）、deeplink。

### 14.4 卡点与世代推进

卡点（调用 `assertCurrentProfile()`）：`DbService.getDb()` / `withWriteTx()`（主危害面，已有 closed-throw 上追加世代比对）、`CacheService.setShared()`（全键强制，shared 键本就按 profile 语义使用）、`PreferenceService` 的 `get/getAll/set/setMultiple`（内存 cache 不经 DbService，自设卡点，替换手写布尔）。不设卡：`getPath`（激活流程自身高频调用，误伤面大；其危害面已被 Trace drain 覆盖）。

推进时机（现有编排不变，插两次状态推进）：

```
step 2 deactivate-all      ← 钩子以旧世代打标:drain 中的写落旧库,合法
       beginSwitch(): current = 'switching'
step 3 repointPaths
       commitGeneration(target): current = {target, gen+1}
step 4 activate-all        ← 新世代
```

drain 期间旧世代仍 current、落旧库合法；逃过 drain 的散兵在 gen+1 后撞墙——分界线即所需。回滚同样推进（单调不回退）。boot 即 gen=1。

### 14.5 undefined 策略

`store === undefined`（boot 早期、迁移器、app 级任务、ALS 丢失点）：放行 + debug 限频日志。误杀 app 级合法工作的代价高于漏放；日志暴露后按需补打标——清单可增长，策略不变。

### 14.6 与现有 drain / 手写守卫的分工

围栏是 fence（拦晚到的写），不是 join（不等落盘）。下表的具名守卫是实现阶段与围栏并行演进的**过渡机制设计**（非现状主干代码；`inFlightExecuted` 是现存的通用在途 map，其余为实现期引入项），列出以界定围栏落地后各自的处置：

| 过渡守卫 | 处置 |
|---|---|
| JobManager `inFlightExecuted` drain（超时→abort 切换）、AiStream / Trace drain | **保留**（终态须落旧库，fence 替代不了落盘） |
| JobManager `_profilePaused`（pump 门） | 保留（礼貌门，围栏兜底） |
| Knowledge / McpCatalog / Preference 的 `profileSwitching` 布尔、McpCatalog `prewarmGeneration` | **删除**（哨兵 + 卡点替代） |
| DirectoryTree `disposeGeneration` | 保留（fd 泄漏不经数据卡点，围栏管不到） |

### 14.7 已知丢失点

EventEmitter 跨上下文（用户态队列 flush 方决定上下文）；boot 期长命定时器 / 队列（`ChannelMessageHandler` 的 8 秒 debounce 属此类，无论围栏与否需单独 drain 修复）；无 AsyncResource 的 native 回调（better-sqlite3 同步无回调、chokidar 走 fs 事件，风险低）；第三方连接池。丢失 → undefined → 放行不误杀，代价是该路径失去保护、靠日志暴露。

### 14.8 错误、性能与测试

- `StaleProfileContextError` / `ProfileSwitchingError` 均响亮失败、由调用方现有错误路径处理；须映射为**不可重试**错误码（renderer DataApiService 对 retryable 自动重试且不区分读写，旧 profile 的变更可被重试跨过提交点写进新库）。job 执行中命中 Stale 定性为 failed（`retryable: false`），由下个世代的 recovery 决定重跑，不算 cancelled。卡点命中 `logger.warn`（诊断信号）；undefined 放行 `logger.debug` 限频。
- ALS 为 Node 原生（pin ≥24），打标 8 类入口各一次、卡点 4 处各一次比对，负载不可测量，零依赖。
- 测试：状态推进序列、判定表四行、DbService 卡点四例、模拟 straddle 集成（gen N 内启动延时任务 → 推进 N+1 → 恢复后写库断言抛错）、入口打标断言。
