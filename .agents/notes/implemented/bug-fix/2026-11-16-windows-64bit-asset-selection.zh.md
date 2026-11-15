# Agent Note: 为管理型 CLI 安装 64 位 Windows 资产

Status: implemented

[English](2026-11-16-windows-64bit-asset-selection.md) | 中文

## 问题

在 64 位 Windows 上，管理型 CLI 安装器可能装成 32 位构建，随后运行时以 `STATUS_DLL_NOT_FOUND`（`0xC0000135`）失败，且没有任何线索指向「安装器选错了架构」。内置的 mise（2026.7.14）把 `win32` 与 `win64` 当作 OS token 而不是架构 token（`src/backend/asset_matcher.rs` 的 `OS_PATTERNS`），因此同时发布 `…-win32.zip` 与 `…-win64.zip` 的 release 会让两者得分完全相同，而 `pick_best_asset` 的同分 tie-break——先比名字长度、再比字典序——会选中 `win32`。上游未改这一行为，桌面端不能指望靠升级 mise 解决。

## 决策

在 64 位 Windows 主机上，`github:` 后端安装成功之后读取已安装可执行文件的 PE 头。只有当它是 32 位 i386 镜像时，带上只匹配 64 位资产 token 的内联 `matching_regex`（`win64`、`x64`、`amd64`、`x86_64`、`x86-64`、`64bit`、`64-bit`；arm64 主机用 `win-arm64`、`arm64`、`aarch64`）把同一版本重装一次。若这次窄化安装失败，则用原始 spec 重装，让已安装的构建继续处于选中状态。主安装之后的每一步都是 fail-open：只记日志并返回，绝不把一次已经成功的安装变成错误。

## 考虑过的替代方案

- 等上游修 mise，期间每一个受影响的安装都是坏的，而且失败点离安装器很远。
- 永远传窄化的 `matching`，会打断资产名不含架构 token 的 release，这比本缺陷带来的回归更大。
- 安装前先取 release 资产清单，等于重复 mise 已经做的事，并把 token、限流与离线处理塞进安装路径。
- 匹配不到 64 位资产就拒绝安装，会把今天可用（虽架构不对）的安装变成硬失败。

## 影响

64 位 Windows 上每次 `github:` 安装多一次本地 PE 头读取。装错架构时多一次下载；release 里没有匹配的 64 位资产时保持今天的行为，只记一条警告。检测只看 shim 解析到的那个可执行文件，因此「可执行文件已正确、但运行时库仍不匹配」的配方不在覆盖范围内。

## 验证

- Regression — `node_modules/.bin/vitest run --project main src/main/services/binaryManager`：9 个文件、301 条用例通过，含新增的 PE 解析用例与重装/恢复的命令序列断言。
- Regression — 去掉 `installWithMise` 里的守卫调用后新用例失败（2 failed, 3 passed），说明它们钉的是行为而不是当前实现。
- Root cause — 读自 mise v2026.7.14 的 `asset_matcher.rs`（`pick_best_asset`、`score_os_match`、`score_arch_match`），并用 `LibreDWG/libredwg` 0.14 的资产清单核对：x64 模式只命中 `libredwg-0.14-win64.zip`。
- Not verified — 未在真实 Windows x64 主机上端到端验证；本机是 macOS arm64，而 mise 的资产目标取自运行时平台，所以 `MISE_PLATFORM=windows-x64` 复现不出这次选择。
