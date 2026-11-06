# Agent Note：OpenClaw 停止操作限定到配置的网关端口

Status: implemented

[English](2026-11-07-openclaw-stop-port-isolation.md) | 中文

## 问题

POSIX 上的 OpenClaw 停止操作使用 `pkill -9 openclaw`，会终止其他网关。Windows 按端口子串筛选 netstat，停止 1879 时也可能终止 18790 的监听者。只按端口匹配还会选中配置端口上的无关应用，即使从未启动网关，退出应用时也可能将它终止。

## 决策

仅查找配置端口上的 TCP 监听者。Windows 解析本地端点和 LISTENING 状态；POSIX 使用 lsof 的 TCP 监听过滤。对正数 PID 去重并排除当前进程。终止每个候选进程前，通过 POSIX `ps` 或 Windows CIM 读取命令行。仅接受精确匹配的 POSIX `openclaw-gateway` 进程标题、运行 `gateway` 的 OpenClaw 可执行文件，或通过 Node/Bun 运行 OpenClaw 包入口及该命令的进程。身份缺失、无法读取或无关的进程均予以保留，并继续使用原有端口停止验证。

## 考虑过的替代方案

- 全局按进程名终止会跨越实例边界。
- 只终止本次创建的子进程无法停止通过配置端口管理的既有网关。
- 端口前缀匹配可能选中另一个网关。
- 端口占用或通用 HTTP 健康响应无法证明监听者的 OpenClaw 身份。

## 后果

停止操作仍管理配置端点上已确认身份的 OpenClaw 网关，包括外部启动的网关。其他端口和未确认身份的监听者保持不变，应用退出时也遵循这一规则。未确认身份的监听者仍占用端口时，停止操作报告失败，不会声称网关已经停止。无需迁移配置或存储数据。

## 验证

- Regression — `pnpm test:main src/main/services/__tests__/OpenClawService.test.ts`：159/159 通过，覆盖精确端口隔离、合法身份、无关及身份不可读的监听者、误导性参数，以及从未启动网关时退出应用。所有进程终止均为模拟。
- Review — 新一轮独立验证确认三项审阅发现均已解决，未确认新的缺陷。
- Electron — 此前的端口隔离版本通过了包含 CODE-03 的 13 项定向测试。当前身份检查的真实 CODE-03/MP-97 及完整 E2E 验证仍待完成。
