# Agent Note: 隔离 uv 缓存避开 macOS 含空格的构建路径

Status: implemented

[English](2026-11-03-binary-uv-cache-path.md) | 中文

## 问题

安装 BabelDOC 时可能需要从 sdist 构建 PyMuPDF。其 Unix 构建命令把缓存中的源码和解释器路径拼接到未加引号的 shell 命令中。隔离安装子进程的 `XDG_CACHE_HOME` 位于 `userData` 下，而 macOS 上该路径通常包含 `Application Support`；因此 uv 继承的缓存路径会让命令在第一个空格处失败（#22853）。

## 决策

注册表将 `feature.binary.data.uv_cache` 定义为 `CHERRY_HOME/cache/uv/<sha256(resolve(userData))>`。解析后的配置目录摘要提供稳定且相互独立的缓存标识，不会把 `Dev Oslo` 这类合法的含空格配置后缀复制到末级目录名中。注册表构建保持 preboot 安全，`NO_ENSURE` 防止路径查询创建未使用的候选目录。仅当隔离环境选用该路径时，BinaryManager 才创建目录。

`getBinaryIsolatedHomeEnv()` 仅在 macOS 上、返回的 `XDG_CACHE_HOME` 包含空白字符且注册的候选路径不含空白字符时添加 `UV_CACHE_DIR`。其他情况下环境保持不变：不回退到真实主目录、临时目录、符号链接或改写后的路径。含空格的主目录或开发根目录仍然合法，但构建路径问题可能依然存在。

现有共享隔离环境将选定路径传递给 mise 安装/移除/查询、托管 Python 以及安装后的 uv 依赖约束流程。已安装工具的执行环境不会收到注入的覆盖值，合并执行环境时会保留调用方的缓存值。HOME/XDG、解释器和安装位置以及环境变量传递白名单保持原有行为。

## 考虑过的替代方案

- 迁移 HOME/XDG、托管 Python 或最终工具环境，会让改动超出实际观察到的缓存内路径操作数。
- 平台缓存目录、临时回退或符号链接会引入另一套所有权策略；`CHERRY_HOME` 已提供 Cherry 自有的配置目录隔离边界。
- 覆盖所有平台或仅覆盖 `mise use`，会改变尚未实测的 Windows/Linux 行为，或拆分现有的管理缓存策略。

## 影响

符合条件的 macOS 管理子进程使用位于 `feature.binary.data` 之外的独立 Cherry 自有缓存。不保证自动清理缓存或将其排除在备份之外。创建选定缓存目录失败时，现有共享目录创建流程也可能影响管理查询；不会通过回退掩盖失败。

此改动针对已实测的 shell 路径故障，不保证每个原生构建或每种合法路径名都能工作。这些单元测试和渲染进程测试未验证 Intel 上的 PyMuPDF 构建，也未验证完整的应用内 BabelDOC 安装和翻译。

## 验证

- Regression — `src/main/utils/__tests__/binaryEnv.macos.test.ts`：为 `Application Support` 选用注册的缓存，保留 HOME/XDG；源路径不含空白字符或候选路径含空白字符时不添加覆盖值，并保留执行环境边界和调用方缓存。
- Regression — `src/main/core/paths/__tests__/pathRegistry.test.ts`：检查路径位于 Cherry 主目录下、解析后的配置目录标识稳定且互异（包括 `Dev Oslo`），以及 `shouldAutoEnsure('feature.binary.data.uv_cache') === false`。
- Regression — `src/main/services/binaryManager/__tests__/BinaryManager.test.ts`：验证 mise、托管 Python 查找及安装后依赖约束子进程的环境携带选定缓存，同时保留解释器和版本约束断言。
- Regression — `src/main/utils/__tests__/binaryEnv.windows.test.ts`：含空格的 Windows 配置路径不接收覆盖值，隔离的 APPDATA/LOCALAPPDATA 路径保持不变。
