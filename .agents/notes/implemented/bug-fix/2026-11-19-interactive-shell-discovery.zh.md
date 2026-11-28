# Agent Note: 系统工具发现的交互式 Shell 回退

Status: implemented

[English](2026-11-19-interactive-shell-discovery.md) | 中文

## Problem

非交互登录 Shell 不读取 `.zshrc`。因此，通过 fnm 安装的工具可能在终端中可用，却在系统工具快照中显示不存在。仅解析绝对路径还不够：Node 启动器仍需要对应的运行环境。

## Decision

保留非交互检测优先。在 POSIX 系统工具查找缺失时，使用现有的 15 秒超时捕获交互登录 Shell，通过分隔符将环境输出与启动横幅隔离。在显式刷新环境之前共享进行中的捕获、成功结果或失败。仅将新增 PATH 目录追加在原目录之后，并将该 PATH 同时用于检测和执行。不把交互 HOME、代理、凭据或运行时管理器变量导入共享环境。只重查缺失工具，保留已解析路径。本地 Agent 在依赖检测完成后重新读取环境。

交互捕获失败时保留已验证的系统结果以及可运行的托管或内置替代项。如果任何缺失工具没有已验证的替代项，则拒绝整批查询，而不是宣称未经验证的工具不存在。无需回退即可成功的查询仍能使用原缓存环境。刷新会使交互捕获失效，旧捕获延迟完成不能覆盖较新的缓存。

## Alternatives considered

- 始终使用交互 Shell：即使不需要也执行提示符插件。
- 硬编码 fnm 或 Codex 路径：遗漏其他运行时管理器，并使检测与执行环境分离。
- 用交互 PATH 替换原 PATH：可能悄悄替换已经发现的可执行文件。
- 启动失败后返回部分结果：当前可用性协议没有逐工具未知状态，会把失败误报为不存在。

## Consequences

首次缺失工具查询可能执行用户的交互启动脚本，最多等待 15 秒。失败缓存保留到刷新。混合批次即使已发现部分工具也可能失败；逐工具未知可用性需要另行修改协议和 UI。原 PATH 优先于交互运行时版本；需要其他运行时时仍可显式配置。Windows 注册表发现逻辑不变。

## Verification

- Regression — `shellEnv.interactive.test.ts`：仅捕获 PATH、非 PATH 变量保持不变、环境副本、启动横幅、有界超时、失败缓存和刷新竞争。
- Regression — `BinaryManager.test.ts` 与 `launch.test.ts`：仅交互可见的工具发现、保留现有工具选择、如实报告失败、启动环境一致性。
- Regression — macOS 实际 Electron 不经过交互父 Shell，以受限父 PATH 冷启动；显式刷新建立基线，未修改 process.env：基线找不到 Codex/Kimi/Qwen/Pi/Grok，生产发现流程找到全部五个工具，实际版本命令成功，Codex 启动采用检测 PATH，非 PATH 环境值保持不变。
