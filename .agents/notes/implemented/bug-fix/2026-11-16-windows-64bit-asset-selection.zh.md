# Agent Note: 为管理型 CLI 安装 64 位 Windows 资产

Status: implemented

[English](2026-11-16-windows-64bit-asset-selection.md) | 中文

## 问题

在 64 位 Windows 上，管理型 CLI 安装器可能装成 32 位构建，随后运行时以 `STATUS_DLL_NOT_FOUND`（`0xC0000135`）失败，且没有任何线索指向「安装器选错了架构」。内置的 mise（2026.7.14）把 `win32` 与 `win64` 当作 OS token 而不是架构 token（`src/backend/asset_matcher.rs` 的 `OS_PATTERNS`），因此同时发布 `…-win32.zip` 与 `…-win64.zip` 的 release 会让两者得分完全相同，而 `pick_best_asset` 的同分 tie-break——先比名字长度、再比字典序——会选中 `win32`。上游未改这一行为，桌面端不能指望靠升级 mise 解决。

## 决策

在 64 位 Windows 主机上，`github:` 后端安装成功之后读取已安装可执行文件的 PE 头。读取器在信任 CLR 条目之前，会检查声明的 `SizeOfOptionalHeader` 和数据目录数量（`NumberOfRvaAndSizes`）；截断或格式错误的镜像会被报告为未知，而不是 64 位。只有当可执行文件是 32 位 i386 镜像时，才带上只匹配 64 位资产 token 的内联 `matching_regex`（`win64`、`x64`、`amd64`、`x86_64`、`x86-64`、`64bit`、`64-bit`；arm64 主机用 `win-arm64`、`arm64`、`aarch64`）重装一次。重装之前，先解析实际已安装的版本，并将窄化 spec 和用于恢复的普通 spec 都固定到该具体版本，避免 `latest` 或模糊版本范围在两条命令之间发生漂移。

若窄化安装或其后的 `reshim` 失败，则用固定版本的普通 spec 重装并运行 `reshim`，恢复对已安装构建的选择。整个附加逻辑都处于单一 fail-open 边界内：只记日志并返回，绝不把一次已经成功的主安装变成错误。若恢复本身失败，日志会明确指出窄化的资产选择可能仍处于配置状态。

## 考虑过的替代方案

- 等上游修 mise，期间每一个受影响的安装都是坏的，而且失败点离安装器很远。
- 永远传窄化的 `matching`，会打断资产名不含架构 token 的 release，这比本缺陷带来的回归更大。
- 安装前先取 release 资产清单，等于重复 mise 已经做的事，并把 token、限流与离线处理塞进安装路径。
- 匹配不到 64 位资产就拒绝安装，会把今天可用（虽架构不对）的安装变成硬失败。

## 影响

64 位 Windows 上每次 `github:` 安装多一次本地 PE 头读取。装错架构时多一次下载；release 里没有匹配的 64 位资产时，在恢复成功的情况下保持今天的行为，并记录一条警告。若恢复失败，窄化的选择可能仍处于配置状态，日志会明确报告这一点。检测只看 shim 解析到的那个可执行文件，因此「可执行文件已正确、但运行时库仍不匹配」的配方不在覆盖范围内。

## 验证

- Regression — `node_modules/.bin/vitest run --project main src/main/services/binaryManager`：9 个文件、329 条用例通过，覆盖严格的 PE 头校验、具体版本固定、fail-open 边界，以及涵盖 `reshim` 和恢复失败的重装/恢复命令序列。
- Regression — `node_modules/.bin/eslint src/main/services/binaryManager --ext .ts`：0 个错误；`node scripts/validation/run.mjs --all --group types`：通过。这两项检查在测试文件修复前均曾在 CI 中失败，现在均已通过。
- Regression — 去掉 `installWithMise` 里的守卫调用后新用例失败（2 failed, 3 passed），说明它们钉的是行为而不是当前实现。
- Root cause — 读自 mise v2026.7.14 的 `asset_matcher.rs`（`pick_best_asset`、`score_os_match`、`score_arch_match`），并用 `LibreDWG/libredwg` 0.14 的资产清单核对：x64 模式只命中 `libredwg-0.14-win64.zip`。
- Not verified — 未在真实 Windows x64 主机上端到端验证；本机是 macOS arm64，而 mise 的资产目标取自运行时平台，所以 `MISE_PLATFORM=windows-x64` 复现不出这次选择。
