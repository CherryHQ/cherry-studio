# Agent Note: 并行执行桌面回归与 standalone smoke

Status: proposed

[English](2026-11-19-parallel-desktop-e2e.md) | 中文

## 问题

[E2E 工作流](../../../../.github/workflows/e2e-regression-test.yml)在每个平台作业内串行执行桌面回归和 standalone smoke。[运行 44433850484](https://github.com/CherryHQ/cherry-studio/actions/runs/44433850484) 中，Windows 的回归阶段耗时约 76 分钟，之后的 smoke 又用了约 31 分钟。[回归检查点](../../implemented/testing/2026-11-08-e2e-report-checkpoint.md)能提前提供回归证据，smoke 仍要等待回归清理结束。

## 提案

统一解析测试引用和套件选择。分支模式下，每个平台以解析出的 SHA 构建一次应用。主进程、预加载、渲染进程和 utility process 产物一起上传，并记录目标 SHA、平台、架构及 Node 和 Electron 版本。平台构建就绪后，各套件在独立 runner 上启动。消费方核对产物与已解析的 checkout 是否一致，并在自己的目录安装依赖、原生模块和运行工具。保留应用需要的可执行权限与捆绑文件，构建产物排除机器本地依赖树、凭据、签名材料和 profile。

桌面回归保留阶段顺序、任务选择、严格的 provider fixture、原生前置条件、发布包安装流程和 controller 的清理责任。Standalone smoke 保留自己的 Playwright 配置、每个用例的独立 profile、平台覆盖和 CI 零重试。分支默认使用 `suite=all`，支持 `suite=regression` 和 `suite=smoke`，`task` 只筛选桌面回归。发布 tag 仍直接针对已发布安装包做桌面回归，无需执行分支构建。

各平台桌面回归完成并脱敏后立即上传证据，交付时间独立于 smoke。产物按套件和平台区分，继续使用各自的公开证据路径白名单。最终汇总收齐预期的套件与平台组合，保留现有回归 HTML 和 smoke 链接。必需结果失败、取消、被跳过或缺失时，最终判定失败，同时保留可用的失败证据。部分重跑可复用同一 workflow run 中未重跑的成功作业报告，但失败或缺失的结果不能用旧产物替代。

## 考虑过的方案

- 在同一个 runner 内并行执行两套测试。原生窗口焦点、全局快捷键、本地端口和应用进程归属会互相影响。
- 在每个套件作业中独立构建。传输更简单，但会重复编译，也难以证明两套测试运行的是同一份构建产物。
- 维持串行并提早交付回归检查点。回归证据能先查看，smoke 仍在串行路径上。

## 验收标准

- AC1 — 单次分支 `suite=all` 运行在每个平台构建一次，四个套件作业独立调度并校验对应构建产物的身份。两套测试保留变更前的用例清单及平台适用范围。 (verification: 工作流契约测试与托管 macOS/Windows 运行; owner: E2E 工作流维护者)
- AC2 — `regression` 和 `smoke` 各自只分配选中的套件作业，定时运行选择两套。发布包回归覆盖两个平台，无需分支构建。 (verification: 工作流契约测试与托管模式选择检查; owner: E2E 工作流维护者)
- AC3 — 某平台回归完成后，即使 smoke 仍在运行也能下载已脱敏的回归报告。汇总在报告齐备时合并，预期结果失败、取消或缺失时阻断最终判定。 (verification: 报告及门禁测试与托管产物观察; owner: E2E 报告维护者)
- AC4 — 在同一应用 SHA 和任务范围下对照，记录墙钟时间、runner 总时长、产物大小和传输时间。 (verification: 托管环境前后对照; owner: E2E 工作流维护者)

## 风险

每个平台使用两个套件 runner，提高了峰值并发并重复部分工作区准备阶段。测量总耗时的同时记录产物传输和原生依赖准备开销。即使源码 SHA 一致，runner 的架构或 ABI 不同仍可能导致应用启动失败。产物身份不一致时应判定准备失败，两端真实桌面行为仍需托管运行验证。
