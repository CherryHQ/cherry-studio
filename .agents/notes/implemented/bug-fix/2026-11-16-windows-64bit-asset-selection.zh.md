# Agent Note: 为管理型 CLI 安装 64 位 Windows 资产

Status: implemented

[English](2026-11-16-windows-64bit-asset-selection.md) | 中文

## 问题

在 64 位 Windows 上，管理型 CLI 安装器可能装成 32 位构建，随后运行时以 `STATUS_DLL_NOT_FOUND`（`0xC0000135`）失败，且没有任何线索指向「安装器选错了架构」。内置的 mise（2026.7.14）把 `win32` 与 `win64` 当作 OS token 而不是架构 token（`src/backend/asset_matcher.rs` 的 `OS_PATTERNS`），因此同时发布 `…-win32.zip` 与 `…-win64.zip` 的 release 会让两者得分完全相同，而 `pick_best_asset` 的同分 tie-break——先比名字长度、再比字典序——会选中 `win32`。上游未改这一行为，桌面端不能指望靠升级 mise 解决。

## 决策

在 64 位 Windows 主机上，`github:` 后端安装成功之后读取已安装可执行文件的 PE 头。读取器在信任 CLR 条目之前，会检查声明的 `SizeOfOptionalHeader` 和数据目录数量（`NumberOfRvaAndSizes`）；截断或格式错误的镜像会被报告为未知，而不是 64 位。只有当可执行文件是 32 位 i386 镜像时，才带上只匹配 64 位资产 token 的内联 `matching_regex`（`win64`、`x64`、`amd64`、`x86_64`、`x86-64`、`64bit`、`64-bit`；arm64 主机用 `win-arm64`、`arm64`、`aarch64`）重装一次。重装之前，先解析实际已安装的版本，并将窄化 spec 和用于恢复的普通 spec 都固定到该具体版本，避免 `latest` 或模糊版本范围在两条命令之间发生漂移。

强制替换之前，先将当前版本可读取的安装目录复制到 `app.temp` 下的临时目录；只有本地备份成功后才继续。

若窄化安装或其后的 `reshim` 失败，先将备份复制回原安装路径（目录已被删除时重新创建）。mise v2026.7.14 在安装前清空该工具的缓存并写入 `<MISE_CACHE_DIR>/<tool-kebab>/<version>/incomplete`；15 分钟超时可能留下该标记，而 mise 只有在版本已安装且不处于 incomplete 状态时才认定它已安装。回灌目录后，若该标记在替换前不存在则将其清除；替换前已存在的标记保持原样。运行 `reshim` 后，只有当 `mise ls --json` 报告该版本的 `installed !== false` 且 shim 能解析出可执行文件时，才算本地回滚成功。这种回滚不需要下载。若任一检查未通过或本地恢复因其他原因失败，则保留备份并退回使用固定版本的普通 spec 执行 `mise use` 恢复；该分支成功后再删除备份。若恢复本身失败，日志会明确指出窄化的资产选择可能仍处于配置状态。

若拿不到安装路径或本地暂存失败，则记录警告并跳过重试，保留当前可用的安装。整个附加逻辑仍处于 fail-open 边界内，只记日志并返回，不向调用方抛出异常。

## 考虑过的替代方案

- 等上游修 mise，期间每一个受影响的安装都是坏的，而且失败点离安装器很远。
- 永远传窄化的 `matching`，会打断资产名不含架构 token 的 release，这比本缺陷带来的回归更大。
- 安装前先取 release 资产清单，等于重复 mise 已经做的事，并把 token、限流与离线处理塞进安装路径。
- 匹配不到 64 位资产就拒绝安装，会把今天可用（虽架构不对）的安装变成硬失败。

## 影响

64 位 Windows 上每次 `github:` 安装多一次本地 PE 头读取。装错架构时，只有实际执行重试才会多一次下载；release 里没有匹配的 64 位资产时，在恢复成功的情况下保持今天的行为，并记录一条警告。若当前安装无法在本地暂存，则跳过重试并记录警告，工具仍可用，但可能还是 32 位构建。从本地备份回滚不依赖下载服务。若恢复失败，窄化的选择可能仍处于配置状态，日志会明确报告这一点。检测只看 shim 解析到的那个可执行文件，因此「可执行文件已正确、但运行时库仍不匹配」的配方不在覆盖范围内。

## 验证

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/services/binaryManager`：9 个文件、335 条用例通过，覆盖严格的 PE 头校验、具体版本固定、fail-open 边界、本地暂存回滚、无法暂存时跳过重试，以及涵盖 `reshim` 和恢复失败的重装/恢复命令序列。
- Regression — `node_modules/.bin/eslint src/main/services/binaryManager --ext .ts`：0 个错误；`node scripts/validation/run.mjs --all --group types`：通过。这两项检查在测试文件修复前均曾在 CI 中失败，现在均已通过。
- Regression — 三个暂存用例在前一个 head b1ae5cb 上失败（3 failed | 256 passed），其中回滚用例的失败信息为 "mise did not report an installed version"。
- Root cause — 读自 mise v2026.7.14 的 `asset_matcher.rs`（`pick_best_asset`、`score_os_match`、`score_arch_match`），并用 `LibreDWG/libredwg` 0.14 的资产清单核对：x64 模式只命中 `libredwg-0.14-win64.zip`。
- Not verified — 未在真实 Windows x64 主机上端到端验证；本机是 macOS arm64，而 mise 的资产目标取自运行时平台，所以 `MISE_PLATFORM=windows-x64` 复现不出这次选择。
