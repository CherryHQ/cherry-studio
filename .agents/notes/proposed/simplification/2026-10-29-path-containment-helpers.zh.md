# Agent Note: 主进程只保留一对路径包含判断函数

Status: proposed

[English](2026-10-29-path-containment-helpers.md) | 中文

## 问题

主进程用十二个各自独立的判断函数来回答「这个路径是否在那个目录里」。它们在四个维度上互相矛盾，其中几个守着安全或数据安全相关的决定：

| 判断函数 | 参数 | 路径相等 | 大小写折叠 | 名为 `..x` 的子项 |
|---|---|---|---|---|
| `isPathInside` — `src/main/utils/file/path.ts` | `(child, parent)` | 在外 | macOS + Windows | 在内 |
| `isSameOrInside` — `src/main/utils/file/path.ts` | `(candidate, container)` | 在内 | macOS + Windows | 在内 |
| `isPathInside` — `src/main/utils/legacyFile.ts` | `(child, parent)` | **在内** | 无 | **在外** |
| `isPathInside` — `src/main/services/userDataRelocation/validation.ts` | `(child, parent)` | 在外 | 调用方预先折叠 | 在内 |
| `isPathInside`（私有）— `src/main/core/security/validateSender.ts` | `(child, parent)` | **在内** | 无 | **在外** |
| `isPathWithin` — `src/main/utils/binaryEnv.ts` | **`(root, candidate)`** | 在内 | 仅 Windows | **在外** |
| `isPathWithin` — `src/main/services/cacheCleanup/shared.ts` | `(target, root)` | 在内 | 无 | 在内 |
| `isInside`（私有）— `src/main/ai/agentSession/fork/AgentSessionForkOperations.ts` | **`(root, file)`** | 在外 | 无 | **在外** |
| `isPathInsideOrEqual`（私有）— `src/main/data/migration/v2/migrators/agentsFilesystemMigration.ts` | `(child, parent)` | 在内 | 判断相等时无 | 在内 |
| `isSameOrWithin`（私有）— `src/main/ai/tools/moveToTrash.ts` | `(target, root, platform)` | 在内 | 仅 Windows | **在外** |
| `isSameOrInsidePath` — `src/main/ai/toolApproval/userDataSqliteGuard.ts` | `(target, root, platform)` | 在内 | macOS + Windows | 在内 |
| `isCanonicalPathInside` — `src/main/utils/agentWebviewRequest.ts` | `(candidate, root)` | 在内 | 无，有意为之 | 在内 |

三个同名的 `isPathInside` 对 `isPathInside(x, x)` 给出相反的答案。两个同名的 `isPathWithin` 参数顺序相反。用 `relative.startsWith('..')` 判断的那些副本，会把第一段以 `..` 开头的子项（例如 `<root>/..x`）误判为在根目录之外。

其中两处差异会让本该拒绝的路径通过守卫：

- **Agent `moveToTrash` 的保护。** `isSameOrWithin` 判断目标是否位于受保护目录（`~/.ssh`、`~/.aws`、`~/Library`、`/usr`、`/System`、`/etc`、Windows 系统根目录等）。`/usr/..x/foo` 或 `~/.ssh/..x` 这样的目标会得到 `path.relative(root, target) === '..x/…'`，于是被当作不受保护。在 macOS 上这个函数不做大小写折叠，所以 `/USR/bin` 或 `~/LIBRARY/Preferences`（在默认的大小写不敏感 APFS 卷上就是同一个目录）也被当作不受保护。用于挂载卷根目录检查的 `isDirectChild` 用的是同样的 `..` 前缀判断。这一问题随 v2.0.0 发布。
- **本地备份目录校验。** 设置页（`LocalBackupSettings` 经由 legacy 的 `App_IsPathInside` 通道）和 `AutoBackupService.validateLocalBackupDirectory` 都用 `legacyFile.isPathInside` 拒绝位于应用数据目录或安装目录内的备份目录。它会接受 `<userData>/..backup`；在 macOS 和 Windows 上还会接受 userData 路径的大小写变体，于是备份可能被写进它所备份的目录里。

其余差异都是失败时关闭：它们拒绝了实际上在内的路径（发送方校验、限定在允许基目录内的文件操作、备份恢复的越界检查、Python 运行时归属、fork 产物归属），或者把 Cherry 管理的二进制误判为外部二进制（`BinaryManager`）。

## 提案

主进程保留一个严格判断和一个包含相等的判断，二者都已从 `@main/utils/file` 导出：

- `isPathInside(child, parent)`：严格后代；路径相等算在外。
- `isSameOrInside(candidate, container)`：相等或后代。

二者都会先解析输入，在 macOS 和 Windows 上做大小写折叠，并且只把 `..` 作为完整路径段匹配。容器始终是第二个参数。

删除这些副本，调用方按下表迁移：

| 删除的函数 | 调用方 | 替换为 |
|---|---|---|
| `legacyFile.isPathInside` | `ipc.ts`（`App_IsPathInside`）、`fileOperations.ts`（4 处）、`LegacyBackupManager.ts`、`AutoBackupService.ts` | `isSameOrInside`（这些调用方依赖「路径相等算在内」） |
| `userDataRelocation/validation.isPathInside` | `validation.ts`、`execution.ts` | `isPathInside`（输入已折叠，相等情况单独处理） |
| `validateSender` 私有的 `isPathInside` | `isAppRendererUrl` | `isSameOrInside` |
| `binaryEnv.isPathWithin(root, candidate)` | `BinaryManager.ts`（2 处）、`pythonRuntime.ts` | `isSameOrInside(candidate, root)`，**参数交换** |
| `cacheCleanup/shared.isPathWithin` | `shared.ts`、`logs.ts` | `isSameOrInside` |
| fork 的 `isInside(root, file)` | `AgentSessionForkOperations.ts`（2 处） | `isPathInside(file, root)`，**参数交换** |
| `isPathInsideOrEqual` | `agentsFilesystemMigration.ts` | `isSameOrInside` |

`legacyFile.test.ts` 中针对 `isPathInside` 的用例随被测函数一起删除。`src/main/utils/file/__tests__/path.test.ts` 补充 `..` 前缀子项和路径相等的用例。

保留三个局部判断函数，它们名字各不相同，且容器都是第二个参数：

- `isSameOrWithin`（`moveToTrash.ts`）和 `isSameOrInsidePath`（`userDataSqliteGuard.ts`）接收注入的 `platform`，并使用 `path.win32` 或 `path.posix`。它们的测试依赖这一点在 POSIX 主机上覆盖 Windows 规则，而共享函数读取的是 `isMac` 和 `isWin` 模块常量。`isSameOrWithin` 和 `isDirectChild` 原地修复：`..` 只作为完整路径段匹配，并且大小写折叠在 `darwin` 和 `win32` 上都生效，与 `isSameOrInsidePath` 现有行为一致。
- `isCanonicalPathInside`（`agentWebviewRequest.ts`）有意对已经规范化的路径做精确比较，与 `src/main/ai/mcp/servers/filesystem/types.ts` 中的精确比较理由相同。

`src/renderer/utils/path.ts` 中的 renderer `isPathInside` 属于另一个进程，语义与主进程的严格判断一致，并且文档已注明它是纯字面判断、不是安全原语。保持不变。

交付分为基于本 Spec 的两个实现层，二者互不依赖：

1. 合并：AC1–AC5。
2. `moveToTrash` 修复：AC6。

不在范围内：

- 重命名 legacy 的 `App_IsPathInside` 通道和 `window.api.isPathInside`。第 1 层之后它们是包含相等的语义，而 renderer 中同名的函数是严格判断。它们随 legacy IPC 迁移一起移除。
- 命名函数之外的五处内联 `relative.startsWith('..')` 判断：`agentSessionWorkspace.ts`、`agents/prompt.ts`、`SkillService.ts`（2 处）和 `KnowledgeMigrator.ts`。它们匹配后都会拒绝，所以是失败时关闭。
- `userDataRelocation/validation.ts` 中的 `normalizeForCompare`。该模块其余的校验仍在使用它。

## 考虑过的替代方案

- 给共享函数加 `platform` 参数，让 `isSameOrWithin` 和 `isSameOrInsidePath` 并入其中：其他所有调用方都要带上一个只为两个测试接缝而存在的参数，而这两个函数在 POSIX 主机上仍然需要 `path.win32`。
- 把 `legacyFile.isPathInside` 的调用方映射到严格的 `isPathInside` 以保留函数名：这些调用方依赖「路径相等算在内」。那样一来，恰好设为 userData 目录本身的备份目录就会被接受。
- 处处精确比较、不做大小写折叠：「在内就拒绝」的守卫（备份目录、缓存清理、数据迁移）需要折叠才能在默认大小写不敏感的卷上识别同一目录，而且共享函数本来就做折叠。
- 保留各个副本，只修两处失败时放行的地方：同名但语义相反的函数对仍然存在，下一个调用方会选中自动补全给出的第一个 import。
- 加一条禁止 `relative(...).startsWith('..')` 的 lint 规则：剩下的五处内联判断都是失败时关闭，而且语法规则抓不到用字符串前缀判断写出的同类错误。

## 验收标准

- AC1 — `src/main` 中除 `@main/utils/file` 的 `isPathInside`、`isSameOrInside` 以及提案中列出的三个局部函数外，不再定义路径包含判断函数，且所有调用方都把容器作为第二个参数传入。 (verification: typecheck + review)
- AC2 — `isPathInside` 和 `isSameOrInside` 把 `<root>/..x` 视为在内，二者只在路径相等时结果不同（分别为 `false` 和 `true`），并且在 macOS 和 Windows 上把根目录的大小写变体视为根目录本身。 (verification: unit)
- AC3 — 无论是设置页经由 `App_IsPathInside`，还是自动备份校验，当本地备份目录等于应用数据目录或安装目录、位于其内（包括 `..x` 子项）、或在 macOS 和 Windows 上是其大小写变体时，都会被拒绝。 (verification: unit)
- AC4 — 对普通的在内、在外和相等输入，数据迁移校验、发送方 URL 校验、二进制归属、Python 运行时查找、缓存清理和 agents 文件系统迁移的判断结果与之前相同，由它们已有的测试断言。 (verification: unit)
- AC5 — fork 发布会拒绝来源位于 fork 产物目录之外的产物，并发布位于其内的产物。 (verification: unit)
- AC6 — `moveToTrash` 会拒绝经由 `..` 前缀路径段落在受保护目录下的目标（`/usr/..x/foo`、`~/.ssh/..x`），并在 darwin 上拒绝受保护目录的大小写变体（`/USR/bin`、`~/LIBRARY/x`）；普通工作区目标仍然允许，win32 上不含 `..` 前缀路径段的路径结果不变。 (verification: unit)

## 风险

- 在 macOS 上做大小写折叠会放宽「在内就允许」的检查：发送方 URL 校验、`fileOperations` 的允许基目录、备份恢复越界检查、Python 运行时和二进制归属、fork 产物归属。在大小写敏感的卷上，名字与根目录只差大小写的同级目录会被算作在内。要利用这一点，需要在根目录旁边有写权限，例如发送方校验需要能在应用包旁边写入。如果评审要求 `validateSender` 精确比较，它就保留一个局部的精确判断，并修正为按路径段匹配 `..`，计划的其余部分不受影响。
- 两处参数交换（`binaryEnv` 的调用方和 fork）的两个参数都是 `string`，类型检查抓不到写反的调用。`BinaryManager` 和 `pythonRuntime` 的测试覆盖了前者；fork 归属目前没有测试，所以 AC5 新增一条。
- 第 1 层大约改动十六个文件，大部分是 import 和调用点变更。第 2 层只涉及 `moveToTrash.ts` 及其测试。
