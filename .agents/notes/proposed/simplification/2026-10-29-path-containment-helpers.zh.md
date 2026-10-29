# Agent Note: 合并主进程中重复的路径包含判断函数

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

包含判断分两类：路径在根目录内时，要么因此**放行**某件事，要么因此**拒绝**某件事。两类需要不同的大小写处理，所以每个调用点按自己的类别选择比较方式：

- **在内就拒绝**的守卫（不把备份放进 userData、不删除包含 userData 的目录、不把数据迁到源目录里）在 macOS 和 Windows 上做大小写折叠。把大小写变体当作同一目录，只会让它们拒绝得更多。
- **在内就放行**的守卫（发送方页面属于应用包、文件操作不越出允许基目录、二进制属于 Cherry 的安装、产物属于 fork）在 macOS 和 Linux 上做精确比较。在大小写敏感的卷上，名字只差大小写的同级目录是另一个目录，这次重构不能开始信任它。

两类都使用 `@main/utils/file` 已经导出的原语。它们都只把 `..` 作为完整路径段匹配，且容器都是第二个参数（`path.relative` 按 Node 自身的签名把容器放在第一个）：

- `isPathInside(child, parent)`：严格后代，做大小写折叠。
- `isSameOrInside(candidate, container)`：相等或后代，做大小写折叠。
- `!isOutsidePath(path.relative(container, candidate))`：相等或后代。`path.relative` 会解析两个路径，并在 macOS 和 Linux 上精确比较。在 Windows 上 `path.win32.relative` 忽略大小写。这与默认的 NTFS 一致，在那里大小写变体指向同一个目录；这些守卫现在也是这样判断的，所以 Windows 上的行为不变。

删除这些副本，调用方按下表迁移：

| 删除的函数 | 调用方 | 类别 | 替换为 |
|---|---|---|---|
| `legacyFile.isPathInside` | `ipc.ts`（`App_IsPathInside`，供备份目录设置使用）、`AutoBackupService.ts` | 拒绝 | `isSameOrInside` |
| `legacyFile.isPathInside` | `fileOperations.ts`（4 处）、`LegacyBackupManager.ts`（备份复制时的符号链接越界检查） | 放行 | 精确 |
| `userDataRelocation/validation.isPathInside` | `validation.ts`、`execution.ts` | 拒绝 | `isPathInside`（输入已折叠，相等情况单独处理） |
| `validateSender` 私有的 `isPathInside` | `isAppRendererUrl`（2 处） | 放行 | 精确 |
| `binaryEnv.isPathWithin(root, candidate)` | `BinaryManager.ts`（2 处）、`pythonRuntime.ts` | 放行 | 精确 |
| `cacheCleanup/shared.isPathWithin` | `pathContainsActiveUserData`（2 处）、`logs.ts` | 拒绝 | `isSameOrInside` |
| `cacheCleanup/shared.isPathWithin` | `pathHasSymlinkedOwnedSegment`（之后会按精确的相对路径逐段遍历） | 放行 | 精确 |
| fork 的 `isInside(root, file)` | `AgentSessionForkOperations.ts`（2 处） | 放行 | 精确、严格（`relative !== '' && !isOutsidePath(relative)`） |
| `isPathInsideOrEqual` | `isManagedLegacyAgentWorkspace` | 放行 | 精确 |

放行类的替换保持现有判断结果，唯一的例外是 `..` 前缀子项现在算在内。`isManagedLegacyAgentWorkspace` 原先把严格部分委托给 `isPathInside`，现在这部分也不再做大小写折叠。

`legacyFile.test.ts` 中针对 `isPathInside` 的用例随被测函数一起删除。`src/main/utils/file/__tests__/path.test.ts` 补充 `..` 前缀子项和路径相等的用例。

保留三个局部判断函数。它们名字各不相同，容器都是第二个参数，且已经符合上面的规则：

- `isSameOrWithin`（`moveToTrash.ts`）和 `isSameOrInsidePath`（`userDataSqliteGuard.ts`）属于拒绝类，做大小写折叠。它们接收注入的 `platform`，并使用 `path.win32` 或 `path.posix`。它们的测试依赖这一点在 POSIX 主机上覆盖 Windows 规则，而共享函数读取的是 `isMac` 和 `isWin` 模块常量。`isSameOrWithin` 和 `isDirectChild` 原地修复：`..` 只作为完整路径段匹配，并且大小写折叠在 `darwin` 和 `win32` 上都生效，与 `isSameOrInsidePath` 现有行为一致。
- `isCanonicalPathInside`（`agentWebviewRequest.ts`）属于放行类，对已经规范化的路径做精确比较，与 `src/main/ai/mcp/servers/filesystem/types.ts` 中的精确比较一致。

`src/renderer/utils/path.ts` 中的 renderer `isPathInside` 属于另一个进程，语义与主进程的严格判断一致，并且文档已注明它是纯字面判断、不是安全原语。保持不变。

交付分为基于本 Spec 的两个实现层，二者互不依赖：

1. 合并：AC1–AC6。
2. `moveToTrash` 修复：AC7。

不在范围内：

- 已经用折叠函数做放行类检查的现有调用方，例如 `McpResourceReadTool`、Claude Code 的 `pathContainment`、`agentDataDirectory`、`agentWorkspaceStorage`、`DiagnosticBundleService`、`doctorTools` 和 `cherryDocumentTools`。本 Spec 不改变它们的行为，按上面的规则审查它们是另一项工作。
- 重命名 legacy 的 `App_IsPathInside` 通道和 `window.api.isPathInside`。第 1 层之后它们是包含相等的语义，而 renderer 中同名的函数是严格判断。它们随 legacy IPC 迁移一起移除。
- 命名函数之外的五处内联 `relative.startsWith('..')` 判断：`agentSessionWorkspace.ts`、`agents/prompt.ts`、`SkillService.ts`（2 处）和 `KnowledgeMigrator.ts`。它们匹配后都会拒绝，所以是失败时关闭。
- `userDataRelocation/validation.ts` 中的 `normalizeForCompare`。该模块其余的校验仍在使用它。

## 考虑过的替代方案

- 给共享函数加 `platform` 参数，让 `isSameOrWithin` 和 `isSameOrInsidePath` 并入其中：其他所有调用方都要带上一个只为两个测试接缝而存在的参数，而这两个函数在 POSIX 主机上仍然需要 `path.win32`。
- 把 `legacyFile.isPathInside` 的调用方映射到严格的 `isPathInside` 以保留函数名：这些调用方依赖「路径相等算在内」。那样一来，恰好设为 userData 目录本身的备份目录就会被接受。
- 处处精确比较、不做大小写折叠：「在内就拒绝」的守卫（备份目录、缓存清理、数据迁移）需要折叠才能在默认大小写不敏感的卷上识别同一目录。
- 处处做大小写折叠（本 Spec 的第一版）：在大小写敏感的 macOS 卷上，「在内就放行」的守卫会开始信任名字与根目录只差大小写的同级目录。对 `isAppRendererUrl` 来说，这意味着信任应用包之外的 HTML 文件，而 `docs/references/ipc/ipc-overview.md` 中的来源信任关卡禁止这样做。
- 在 `isPathInside` 和 `isSameOrInside` 旁边再导出一个具名的精确判断函数：`isOutsidePath` 已经是导出且有文档的精确原语，第三个包含判断的名字会把本 Spec 要消除的命名问题带回来。
- 保留各个副本，只修两处失败时放行的地方：同名但语义相反的函数对仍然存在，下一个调用方会选中自动补全给出的第一个 import。
- 加一条禁止 `relative(...).startsWith('..')` 的 lint 规则：剩下的五处内联判断都是失败时关闭，而且语法规则抓不到用字符串前缀判断写出的同类错误。

## 验收标准

- AC1 — `src/main` 中除 `@main/utils/file` 的 `isPathInside`、`isSameOrInside`、`isOutsidePath` 以及提案中列出的三个局部函数外，不再定义路径包含判断函数；每个迁移过的调用点都使用其类别要求的比较方式，见提案中的表格。 (verification: typecheck + review)
- AC2 — `isPathInside` 和 `isSameOrInside` 把 `<root>/..x` 视为在内，二者只在路径相等时结果不同（分别为 `false` 和 `true`），并且在 macOS 和 Windows 上把根目录的大小写变体视为根目录本身。 (verification: unit)
- AC3 — 无论是设置页经由 `App_IsPathInside`，还是自动备份校验，当本地备份目录等于应用数据目录或安装目录、位于其内（包括 `..x` 子项）、或在 macOS 和 Windows 上是其大小写变体时，都会被拒绝。 (verification: unit)
- AC4 — 在 macOS 和 Linux 上，发送方 URL 校验拒绝位于「名字与应用根目录只差大小写」的同级目录下的 `file:` URL；在所有主机上，它都接受位于应用根目录 `..x` 子项下的 URL，且 Windows 上的大小写处理不变。 (verification: unit)
- AC5 — 对普通的在内、在外和相等输入，数据迁移校验、发送方 URL 校验、二进制归属、Python 运行时查找、缓存清理和 agents 文件系统迁移的判断结果与之前相同，由它们已有的测试断言。 (verification: unit)
- AC6 — fork 发布会拒绝来源位于 fork 产物目录之外的产物，并发布位于其内的产物。 (verification: unit)
- AC7 — `moveToTrash` 会拒绝经由 `..` 前缀路径段落在受保护目录下的目标（`/usr/..x/foo`、`~/.ssh/..x`），并在 darwin 上拒绝受保护目录的大小写变体（`/USR/bin`、`~/LIBRARY/x`）；普通工作区目标仍然允许，win32 上不含 `..` 前缀路径段的路径结果不变。 (verification: unit)

## 风险

- 放行类调用点保持精确比较，所以在默认大小写不敏感的卷上，它们仍会拒绝一个确实在内、但拼写的大小写不同的路径。这是现有行为，属于失败时关闭；调用方传入的是 realpath 或由根目录拼出的路径，拼写与根目录一致。
- `binaryEnv` 的调用点和 fork 检查的参数顺序会变：精确形式里容器是 `path.relative` 的第一个参数。所有参数都是 `string`，类型检查抓不到写反的调用。`BinaryManager` 和 `pythonRuntime` 的测试覆盖了前者；fork 归属目前没有测试，所以 AC6 新增一条。
- 在 Windows 上，如果某个目录开启了按目录区分大小写（例如与 WSL 共享的目录），放行类守卫仍会信任只差大小写的同级目录。现有代码的行为相同，而默认的 NTFS 卷不区分大小写。
- 每个调用点都要按类别归类，归错会放宽或收紧那一个守卫。提案中的表格记录了每处的归类，方便评审逐项核对。
- 第 1 层大约改动十六个文件，大部分是 import 和调用点变更。第 2 层只涉及 `moveToTrash.ts` 及其测试。
