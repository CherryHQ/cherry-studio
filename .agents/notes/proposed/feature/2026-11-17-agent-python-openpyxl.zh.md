# Agent Note: 为 Agent Python 运行时提供 openpyxl

Status: proposed

[English](2026-11-17-agent-python-openpyxl.md) | 中文

## Problem

Agent 通过 `python_execute` 处理 XLSX 文件，该工具在渲染进程中的 Pyodide v0.28.0 里运行 Python 3.12（`src/renderer/workers/pyodide.worker.ts:17-18`，`src/main/ai/mcp/servers/python.ts:24-27`）。Pyodide 只能从自身的 lockfile 中加载包，并在运行时从 `cdn.jsdelivr.net` 获取。v0.28.0 的 `pyodide-lock.json` 包含 `pandas` 2.3.0，但不包含 `openpyxl` 及其依赖 `et-xmlfile`，因此 `import openpyxl` 会失败，而且 Agent 无法通过 pip 安装（不存在 pip 路径），只能手动转换文件。

`src/main/services/binaryManager/pythonRuntime.ts` 中由 uv 管理的 CPython 是第二个解释器。它服务于 mise 的 pipx 工具，目前只为 babeldoc 安装 `bitstring<5`（`src/shared/data/presets/binaryTools.ts:59-70`）。它不是 Agent 的代码运行时，本提案不会改动它。

Issue #19320 的两项需求相互冲突：Agent 必须能立即（包括离线）导入 `openpyxl`，而 Pyodide 的包加载器依赖 CDN。

## Proposal

将 `openpyxl` 及其纯 Python 依赖 `et-xmlfile` 随 Agent 的 Pyodide 运行时一同发布，使 `import openpyxl` 在无网络时也能工作。

- 将固定版本的 wheel 打包进应用的 Pyodide 资源，并在用户代码运行前注册到 Pyodide 的包加载器。两个 wheel 都是纯 Python（`py3-none-any`），无需构建步骤。
- 在 Pyodide worker 读取的同一位置固定版本号，并记录与之兼容的 Pyodide 版本，因为 Pyodide 升级可能改变兼容的版本组合。
- 在 Agent 运行时诊断信息中展示已安装的 `openpyxl` 版本和 Pyodide 版本。
- 保持托管环境只读：`micropip` 和用户安装不在本次范围内。缺失的包只报告托管依赖问题，不执行 `pip install`。

范围不包括 XLSX 产物预览（已由 `packages/file-preview` 提供）以及其他数据科学包。

## Alternatives considered

- **依赖 Pyodide 的 CDN 包集合。** 不采用：Pyodide 0.28.0 不含 openpyxl，且此路径需要网络，与 issue 的离线要求冲突。
- **将 openpyxl 安装到 uv 管理的 CPython，并桥接到 Agent 代码。** 本范围内不采用：Agent 代码运行在 Pyodide 中，桥接会引入第二个进程、新的 IPC 契约和需要保持兼容的第二个 Python 版本。若未先部署该解释器，也无法离线运行。
- **升级到包含 openpyxl 的 Pyodide 版本。** 暂不采用：升级会同时改变所有 Pyodide 包，是独立的决策。若后续 Pyodide 版本包含 openpyxl，仍可作为选项。

## Acceptance criteria

- AC1 — 无网络的干净托管 Agent 运行时可以执行 `import openpyxl`、打开已有工作簿、修改单元格并保存为有效的 XLSX（verification: Electron）
- AC2 — `openpyxl` 和 `et-xmlfile` 从打包的 wheel 加载，且 Pyodide worker 不为它们发起网络请求（verification: renderer）
- AC3 — 运行时诊断信息显示 openpyxl 版本和 Pyodide 版本（verification: renderer）
- AC4 — 缺失或损坏的打包 wheel 会报告托管依赖问题，且不执行任何安装命令（verification: renderer）
- AC5 — 应用升级后，已有 Agent 工作区保持相同的打包版本，且固定版本在 CI 中被检查（verification: docs gate）

## Risks

- 打包会使应用体积增加约 openpyxl 与 et-xmlfile 的大小，实现前需要测量。
- Pyodide 的加载器必须接受额外的本地 wheel 索引，同时不改变其他包的解析方式。实现前应验证此点，再确定方案。
- 若 Pyodide 之后自带 openpyxl，应移除打包副本并改用 CDN 包，以避免两个版本并存。
