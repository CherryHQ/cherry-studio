# 多 Profile 基础架构设计

需求见 [RFC](./rfc-multi-profile.md)。本文件定义各机制的状态、时序与失败行为。

## 1. 总览

一个 profile 是一份隔离的数据：独立 SQLite 库与 Data 目录。切换 profile 不重启进程。切换时每个持有 per-profile 资源的服务从旧 profile 的资源转移到新 profile 的资源（§6、§8）；路径、注册表、profile 根（§2–§4）提供 profile 到磁盘位置的映射。

## 2. 路径模型（RFC 4.1）

路径 key 分两类：app 级跨 profile 恒定，profile 级随当前 profile 变。`PROFILE_PATH_KEYS` 列出全部 profile 级 key，其余为 app 级；`isProfilePathKey(key)` 据此判别。

两张表：

- `appMap`：`buildAppPathRegistry()` 于 boot 构造并冻结，此后不变。
- `profileSlot`：`buildProfilePathRegistry(roots)` 按当前 profile 根构造，切换时（§8 步骤 3）整体替换。

解析：`getPath(key) = isProfilePathKey(key) ? profileSlot.get(key) : appMap.get(key)`。

不变量：`profileSlot` 在任何 profile 级路径解析之前安装（预启动，§5）；app 级路径不依赖 profile。

## 3. Profile 注册表与激活指针（RFC 4.6）

```ts
type ProfileEntry = { readonly id: string; readonly name: string; readonly dataDir: string; readonly createdAt: number }
type ProfileRegistry = { readonly activeProfileId: string; readonly profiles: readonly ProfileEntry[] }
```

落盘于 `~/.cherrystudio/profiles.json`。

- `id`：8 位 base62 `nanoid`（`customAlphabet('0-9A-Za-z', 8)`，无前缀），不可变；`addProfile` 生成时对现有 id 查重、撞则重生成。默认 profile 保留 id `default`（不经生成器）。
- 变换：`addProfile / renameProfile / setActive : ProfileRegistry -> ProfileRegistry`；`findEntry(reg, id)`。
- 读写：`readProfileRegistry()` 读并校验，文件缺失或损坏时回落到仅含默认 profile 的注册表；`writeProfileRegistry(reg)` 经临时文件 + rename 原子写。
- `readProfileRegistry` 的返回值中 `activeProfileId` 必指向存在的 entry（校验不过则回落默认），下游不再判空。
- boot 期经 `resolveBootProfile()` 记忆化，全 boot 只读一次盘。

## 4. Profile 根与迁移（RFC 4.7）

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

## 6. 激活模型（RFC 4.2）

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

## 7. DbService（RFC 4.3）

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

## 8. 切换编排（RFC 4.4）

`ProfileService.switchProfile(target)`：

1. 置切换中；拒绝并发切换。
2. `deactivate-all`（逆依赖序：writers 先，`DbService` 最后；stop-on-throw）。
3. `profileSlot` 重指向 target 根（§2）。
4. `activate-all`（正依赖序：`DbService` 先），随后统一 recovery（job / knowledge 等重挂）。
5. 提交：`writeProfileRegistry(setActive(reg, target))`（磁盘 `activeProfileId` 仅此步改）。
6. renderer 重置（§9）。
7. `fire(onProfileDidSwitch)`；清切换中。

逆序 deactivate 保证写者在 `DbService` 关库前释放，在途写者不写向正在关闭的库。

**回滚**：提交（步骤 5）前任一阶段失败，对 previous 执行 `activate-all(previous)`。由 §6 收敛性，无论各参与者处于 `bound(target)` / `unbound` / `bound(previous)`，均回到 `bound(previous)`；单阶段、按激活序执行，不为回滚再逆序 deactivate（回滚以恢复到可用的 previous 为目标，`release-then-acquire` 释放的 target 资源不写入已重开的 previous 库）。回滚自身失败为致命错误，提示重启。提交后失败（步骤 6–7）不回滚 profile，记录并按需重试。

## 9. Renderer 重置（RFC 4.5）

切换提交后 renderer 内存态（SWR / Preference / Cache）须重读新 profile：

- 关闭全部非主窗口（pooled 类型先 `suspendPool` 排空 standby，再关在用实例；singleton 直接关）。
- reload 主窗口；reload 前在其 `sessionStorage` 置一次性标志 `PROFILE_SWITCH_PERSIST_FLAG`（共享常量），renderer 开机识别后丢弃上一 profile 的 `cs_cache_persist` 并从默认播种。

per-profile 缓存清除：shared cache 由各 owner 在 `onProfileDeactivate` 调 `CacheService.deleteSharedByPrefix(prefixes)` 清自己的派生键（如 `jobs.state.`、`topic.stream.`）；persist cache 由 renderer 按上述标志整体丢弃。

## 10. 服务分类（RFC §3）

`ProfileActivatable`（持有 per-profile 资源的 owner）：`DbService`、`PreferenceService`、`KnowledgeVectorStoreService`、`DirectoryTreeManager`、`AiStreamManager`、`AgentSessionRuntimeService`、`JobManager`、`McpRuntimeService`、`McpCatalogService`、`ChannelManager`、`TraceStorageService`、`ApiGatewayService`。

共享基建不实现（跨 profile 全局）：`SchedulerService`、`CacheService`。`SchedulerService` 上的 per-profile 调度由 `JobManager` 在其 `onProfileDeactivate` dispose；`CacheService` 的 per-profile 派生项由各 owner 按前缀清（§9）。判据：状态是否随 profile 变而必须换。

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

## 12. 测试

- 决策与解析函数：`isProfilePathKey`、`build*PathRegistry`、注册表变换、`resolveProfileRoots`、`decideActivate` / `decideDeactivate`——覆盖输入组合。
- 解释器：`BaseService` 激活 / 停用的 binding 转移，含抛错分支与收敛。
- `DbService` 真库集成：开库、迁移、seed、关库、换库隔离；`withWriteTx` 同步事务原子性（`setupTestDatabase`）。
- 注册表持久化：原子写、损坏文件回落、boot 单次读。
- 切换与回滚：步骤 2 / 4 各失败点注入，断言回滚回到 previous、`profiles.json` 未提交、无跨 profile 串数据。
- boot 两段激活：断言 Tier-1 / Tier-2 激活序与 `DbService` 先于开窗。
