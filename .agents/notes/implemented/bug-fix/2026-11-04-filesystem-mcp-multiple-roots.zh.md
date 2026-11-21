# Agent Note: Filesystem MCP 授权所有配置根目录

Status: implemented

[English](2026-11-04-filesystem-mcp-multiple-roots.md) | 中文

## 问题

内置 `@cherry/filesystem` MCP 的配置参数按行存入 `mcp_server.args`，但 `resolveFilesystemBaseDir` 使用 `args.find(...)` 只选取第一个非空参数。`createFileSystemServer(baseDir)` 及其七个 handler 只捕获一个根，`validatePath` 也只对该根做 canonical 包含判断。因此只有配置的第一行可访问，其余根下的路径均报 `Access denied: Path is outside the configured workspace root: <path>`。调换行序只会改变哪个根排在第一位（Issue #23484）。

## 决策

配置参数构成有序允许根集合。`resolveFilesystemBaseDirs` 返回所有去除首尾空白后的非空参数。`WORKSPACE_ROOT` 去除首尾空白后非空时，独占并整体覆盖参数列表，作为单个根使用，不按分隔符拆分。无配置时解析器返回空数组，由 server 回落到 `feature.mcp.workspace`。

server 对每个根执行 `expandHome`，只保留绝对路径，再 resolve 和 normalize，按规范化字符串精确去重并保留顺序。只有结果为空才回落到 workspace。每次创建 server 时，对最终的每个根各尝试一次 best-effort 递归 `mkdir`。七个 handler 均接收最终的根集合。

对于绝对目标，`validatePath` 每次校验只 canonicalize 目标一次，任一配置根与其满足 canonical 包含关系即放行。对于相对目标，按根顺序解析候选，且每个候选只与生成它的那个根比较。已获授权但不存在的候选不会触发对后续根中同名文件的查找。所有包含检查均失败时，校验保留上面的完整 access-denied 原文案。

省略 `path` 时，`ls`、`glob`、`grep` 仍以第一个有效根为目标。其 `||` 回落也将空字符串视为省略，工具描述明确说明该默认值。展示路径使用 `getRelativePath`，相对于第一个 canonical 目录包含 canonical 目标的配置根计算；没有根匹配时返回绝对目标。`grep` 将 ripgrep 的相对结果按子进程 cwd（`process.cwd()`）解析，再对所有配置根复核。

## 考虑过的替代方案

- 只保留第一个根，就是保留缺陷本身。
- 默认让 `glob` 和 `grep` 搜索所有根，需要重新定义跨根去重、全局排序以及 100 条结果截断的公平性，超出本次修复范围。
- 将每个相对候选与任意根比较，会额外放行跨根路径，改变原有相对路径语义。
- 按 `realpath` 去重，或移除重叠根、子根，会改变默认目标和展示路径所用的根。
- 按文件存在性搜索后续根，可能让同一相对名称的读取与写入落到不同位置。

## 影响

多根构成信任集合，不是根之间的隔离边界。对于按完整集合校验的目标，包括绝对路径和遍历结果，允许通过一个配置根访问另一个配置根。相对候选仍遵守上述配对根规则。配置根本身是 symlink 时，授权其真实目录。每次校验仍重新 canonicalize 路径，没有启动期缓存，既有的检查与使用之间的竞态（TOCTOU）限制不变。

修复伴随两处有意的可见变化：工具描述写明默认目标；单根为 symlink 别名时，展示路径改为相对于其 canonical 目录。例如，旧版的 `../real-root/f` 变为 `f`。`WORKSPACE_ROOT` 优先级、未配置时回落 workspace、单根授权语义、工具名、入参和 transport 均不变。

## 验证

以下实测结果由实现运行提供；本次仅补写文档，不重新执行测试。

- Regression — 新测试文件 `src/main/ai/mcp/servers/filesystem/__tests__/filesystem.multiroot.test.ts` 在修复前的基线副本上：9 failed / 3 passed，失败形态都是上述 access-denied（不是收集失败或类型错误）。
- Regression — 修复后同一次运行：`filesystem.multiroot.test.ts`、`filesystem.test.ts`、`grep.test.ts`、`saveAttachment.test.ts`、`moveToTrash.test.ts`、`assistantFileSafety.test.ts`、`AssistantFileToolsServer.test.ts` 共 7 文件 / 92 tests，全绿。新测试文件覆盖所有根及正反顺序下的七个工具、默认目标、拒绝根外访问且不发生写入、symlink 逃逸、相对路径选择、环境变量优先级与 workspace 回落、遍历结果过滤、相对 cwd 的 grep 结果、匹配根展示路径、重叠根与别名根、主目录展开，以及同名 grep 结果互不混淆。

未验证：真实 Electron 端到端、Windows 盘符/junction 行为、CI 结果。
