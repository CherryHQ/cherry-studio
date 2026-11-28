# Agent Note: 修复缺失 dsh-scope 的截断托管 DeepSeek Harness 安装

Status: implemented

[English](2026-11-27-dsh-scope-repair.md) | 中文

## 问题

托管 `@deepseek-ai/dsh@0.1.1-rc.2` 在就绪前退出，报错 `ERR_MODULE_NOT_FOUND`，缺失被 `@deepseek-ai/dsh-agent-loop` 引入的 `@deepseek-ai/dsh-scope`。`dsh-scope` 只是传递性 peer 依赖，npm 可能在缺失时仍然报告成功。DSH 依赖图约 455 个包，仅解析就需要约 12 分钟，共享的 15 分钟安装预算在 Windows 加杀毒软件冷缓存下会被截断。 plain `mise use -g` 在版本已激活时直接 no-op，缺失的 peer 仍然存在。启动时仍会拉起已损坏的二进制，只报告 `exited before it was ready (code 1)`，没有缺失包名和修复入口。

## 决策

DSH 预设携带 `installTimeoutMs: 30 * 60_000`，经 `MISE_INSTALL_TIMEOUT_OVERRIDES` 与 `FIXED_CATALOG` 传入 `installWithMise` 与 `installPipxTool`。`runMise` 在 `shellOutNpm` 时设置 `NPM_CONFIG_LEGACY_PEER_DEPS=false` 以及 `FUND/AUDIT=false`；隔离 `HOME` 本来就屏蔽用户 `.npmrc`。必需 peer 探针从包自身的 JS 入口解析 host，并带 Windows npm prefix 回退：当从 launcher `createRequire` 看不到嵌套 host（launcher 在安装 prefix 顶层，`dsh-agent-loop` 在顶层包自己的 `node_modules` 下）时，会改从 `<install>/node_modules/<pkg>/package.json`（含 `lib/` 与 launcher 父目录变体）重试，确认后才判定树健康。仅在 peer 缺失被验证时，损坏的必需 peer 安装才做按版本清理重装（先准备 Node，再 `unuse -g` 尽力执行、`uninstall <tool>@<broken-version>`、仅在拿不到版本时回退 `--all`、`reshim`、重新 `use`），使 Retry 真正修复依赖树。仅缺 shim 时保留原树并报通用 runnable 失败。安装后门禁仅在 peer 缺失被验证时才报缺失 peer。`DeepSeekHarnessService.findBinary` 仅对托管（`mise`）副本在 `broken`/`unknown`/`conflict` 时直接失败，给出包含 `dsh-scope` 与 Code → DeepSeek Harness → Retry 指引的可操作错误，不再拉起子进程；可用的 `system` 副本会被保留，`source: 'none'` 但 peer 缺失已验证时仍给出修复入口。

## 考虑过的替代方案

- 全局提高 15 分钟超时会拖慢所有无关工具的失败反馈。
- 不清理直接重试 `mise use -g` 会在同版本已激活时 no-op。
- 启动时静默自动重装会掩盖故障，并与 Dependencies 操作竞态。
- 仅依赖用户 `.npmrc` 卫生不足，因为隔离安装 `HOME` 已屏蔽它，而未来 mise 配置透传仍可能重新引入 legacy peer 语义。

## 影响

DSH 安装最多可持有安装锁 30 分钟，其他工具保持 15 分钟预算。已验证损坏的 DSH 在 Node 准备好后只清理受影响版本，Node 失败不会删掉基线仍可用的版本；仅缺 shim 时保留原树并通过普通 `use` 重试。损坏 DSH 的 Retry 不能与另一个 DSH 变更并发执行（现有 mutation mutex 已串行化）。损坏的托管 DSH 不再拉起，只给出修复指引而非仅退出码 1，可用的系统 DSH 仍可启动。系统来源的 DSH 因无托管 application 事实而绕过 peer 门禁。

## 验证

- 回归 — `src/main/services/binaryManager/__tests__/BinaryManager.test.ts`：DSH 使用 30 分钟超时，shell-out 设置 legacy-peer-deps 为 false，已验证损坏时按版本清理并先准备 Node 再 wipe，Windows prefix 布局经包入口检出并走同一修复路径，仅缺 shim 时保留原树并报通用 not-runnable，仍不完整时抛出缺失 peer 错误。
- 回归 — `src/main/services/deepSeekHarness/__tests__/DeepSeekHarnessService.test.ts`：托管损坏快照直接失败并给出 dsh-scope 与 Retry，且不拉起进程；托管未知状态同样直接失败；系统损坏与系统未知保留系统路径并可启动；无 fallback 的损坏仍给出 Code → DeepSeek Harness → Retry 修复入口。
- 回归 — `src/shared/data/presets/__tests__/codeCliTools.test.ts`：预设形状与目录身份保持有效。
