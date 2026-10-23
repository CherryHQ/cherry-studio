# Agent Note: 不依赖 Tier 3 初始化的 Windows 沙盒 CI

Status: implemented

[English](2026-10-19-sandbox-windows-ci.md) | 中文

## 问题

Windows Server CI 在 MXC Tier 3 系统盘初始化期间停滞。上游关闭相关 issue 的原因是弃用 Tier 3，并未合并所提修复。维护宿主初始化 fork 会让 Cherry 继续依赖这条路径。

## 决策

Windows Server 2025 运行沙盒契约测试，不执行原生沙盒初始化。原生 CLI、Node/Python RPC、Windows 边界和 CLI 隔离验收改用 GitHub 托管的 `windows-11-arm` 镜像。执行前要求 Windows 11 24H2+、MXC 实际选择 BaseContainer 隔离层，且公共 probe 就绪。CI 不执行 Tier 3 初始化或回退。

demo 必需验收覆盖沙盒命令、双向 RPC、授权与拒绝文件访问、loopback 拒绝，以及宿主 ACL 保持或恢复。排除 detached 后代终止：公共完成契约返回 `tree: unverified`，并不保证整树终止。负责人接受这一收窄后的范围；原生任务仍是必需检查，不忽略失败。

Windows 11 矩阵任务纳入现有必需的 general gate。Server 契约测试通过不能替代原生验收。

## 考虑过的替代方案

- 维护打补丁的 Tier 3 host-prep 产物：已由负责人否决。
- 自建 Windows 11 runner：可以先验证托管 ARM64 镜像，无需立即自建。
- 环境不可用时跳过原生测试：会掩盖验收覆盖缺口。

## 后果

托管镜像没有可用 BaseContainer 时明确失败。ARM64 结果不能证明 Windows x64 或打包 Electron 通过验收。现有 Tier 3 setup 命令保留为早期实验工具，不作为维护中的 CI 依赖。调整 CI 测试位置不改变适配器运行时的隔离层选择。移除后代测试不代表修复或验证了子进程启动：托管 BaseContainer 测试在终止断言前就报出 `spawn node.exe ENOENT`。该宿主上的子进程启动与后代回收仍未通过验收。

## 验证

- Regression — `scripts/__tests__/validationPlan.test.ts` 验证 Windows 和 macOS 的平台选择，保留全部 Windows 沙盒契约测试，并排除 Server 上的原生执行。
- Regression — `scripts/__tests__/validationWorkflow.test.ts` 检查 Windows 11 保留原生测试命令、纳入必需 gate，且不忽略失败。
- Native acceptance — `packages/sandbox/tests/acceptance/windowsHost.test.ts` 在 Windows 11 CI 测试前拒绝 BaseContainer 以外的隔离层。托管任务在 `f6bc99c2ae8` 上通过此前置检查及 14 项 CLI/RPC/边界测试，但后代测试在 spawn 阶段失败。独立的 CLI 隔离验收步骤未执行。删除该用例是范围决策，不代表整个原生任务已通过，仍需新的运行结果。
