# Agent Note: 不依赖 Tier 3 初始化的 Windows 沙盒 CI

Status: implemented

[English](2026-10-19-sandbox-windows-ci.md) | 中文

## 问题

Windows Server CI 在 MXC Tier 3 系统盘初始化期间停滞。上游关闭相关 issue 的原因是弃用 Tier 3，并未合并所提修复。维护宿主初始化 fork 会让 Cherry 继续依赖这条路径。

## 决策

Windows Server 2025 运行沙盒契约测试，不执行原生沙盒初始化。原生 CLI、Node/Python RPC、Windows 边界和 CLI 隔离验收改用 GitHub 托管的 `windows-11-arm` 镜像。执行前要求 Windows 11 24H2+、MXC 实际选择 BaseContainer 隔离层，且公共 probe 就绪。CI 不执行 Tier 3 初始化或回退。

Windows 11 矩阵任务纳入现有必需的 general gate。Server 契约测试通过不能替代原生验收。

## 考虑过的替代方案

- 维护打补丁的 Tier 3 host-prep 产物：已由负责人否决。
- 自建 Windows 11 runner：可以先验证托管 ARM64 镜像，无需立即自建。
- 环境不可用时跳过原生测试：会掩盖验收覆盖缺口。

## 后果

托管镜像没有可用 BaseContainer 时明确失败。ARM64 结果不能证明 Windows x64 或打包 Electron 通过验收。现有 Tier 3 setup 命令保留为早期实验工具，不作为维护中的 CI 依赖。调整 CI 测试位置不改变适配器运行时的隔离层选择。

## 验证

- Regression — `scripts/__tests__/validationPlan.test.ts` 验证 Windows 和 macOS 的平台选择，保留全部 Windows 沙盒契约测试，并排除 Server 上的原生执行。
- Regression — `scripts/__tests__/validationWorkflow.test.ts` 检查 Windows 11 保留原生测试命令、纳入必需 gate，且不忽略失败。
- Native acceptance — `packages/sandbox/tests/acceptance/windowsHost.test.ts` 在 Windows 11 CI 测试前拒绝 BaseContainer 以外的隔离层。托管任务尚待执行；本机 macOS 检查不代表 Windows 验收通过。
