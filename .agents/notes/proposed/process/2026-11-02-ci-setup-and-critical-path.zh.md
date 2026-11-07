# Agent Note: CI 准备阶段与关键路径优化

Status: proposed

[English](2026-11-02-ci-setup-and-critical-path.md) | 中文

## Problem

2026-11-02 审计使用 `gh` 获取最近 50 次仓库 workflow 和最近 50 次 CI。后者快照包含 20 次取消、12 次跳过、13 次未完成、4 次等待批准和 1 次失败，没有成功基线。另取最近 50 次成功 CI，时间范围为 UTC 03:08:28–08:33:42。这是混合验证范围的观察样本，不能据此证明优化收益。

成功 job 的准备 / 验证步骤耗时中位数：macOS 为 156 / 84 秒（41 个样本），Windows 为 148 / 148 秒（41 个），basic checks 为 64 / 282.5 秒（50 个），renderer 第 1 片为 63.5 / 308.5 秒（32 个）。验证步骤还包含内部准备，需通过日志分离 workspace 构建、原生重建与 Vitest。排队中位数为 2–3 秒，样本不支持购买其他 runner。不能相加各阶段独立分位数来估算总墙钟时间。

两个平台 job 的 41 个样本均没有精确依赖缓存命中。[运行 41413969420](https://github.com/CherryHQ/cherry-studio/actions/runs/41413969420) 中两个平台都恢复了旧锁文件键。共享 setup action 只有 Linux basic job 允许写缓存。采集时 cache-usage 接口报告 9,903,845,526 字节；缓存列表是另一个持续变化的快照。安装依赖会构建七个 workspace 包，随后 `scripts/validation/run.mjs` 再次构建。本地连续执行这段准备分别耗时 6.74 和 7.88 秒，均成功；这不是应用构建基准。

当前同一分支的 push 共用 concurrency group。`cancel-in-progress: false` 保护正在运行的任务，但不保护排队中的旧任务免遭替换。main 必须保留每个推送提交的验证。通过实时 main rules 接口确认，必需检查仍为 `basic-checks`、`general-test`、`render-test`。

本方案部分取代[现有 CI 提案](2026-10-01-ci-and-local-validation.md)中的调度和缓存方向。其共享清单、失败关闭门禁、运行时 Markdown 覆盖和原生 ABI 契约继续适用。本方案不声称旧提案尚未验证的验收条件已经完成。

## Proposal

1. 保留按 PR 取消旧运行，非 PR 的 CI 用 run ID 创建独立 concurrency group。main 每次 push 对推送后的 head 执行完整验证计划；PR 保留保守的受影响范围选择。发布流程单独保留串行化。
2. 纯文档 PR 仍触发必需 CI workflow。选择文档/格式检查并明确通过汇总门禁，跳过应用测试、原生准备和代码专属检查。运行时 Markdown、混合修改、未知输入和历史缺失仍选择必要检查。不能用顶层路径排除导致必需上下文持续 pending。
3. 安装锁定版本的 pnpm 后，优先使用 `setup-node` 的 pnpm 缓存，以根锁文件为依赖输入。从 main 填充包括 Windows/macOS 在内的平台缓存，并在第二次与 main 兼容的运行中验证精确命中。默认不缓存全部 `node_modules`、原生 ABI 产物或无关构建产物。分别测量归档大小、传输、解压和安装，避免重复归档并遵守仓库缓存预算。
4. 每个 CI job 的 workspace 准备由一个明确步骤负责。保留第三方/原生依赖的正常安装生命周期。把 workspace 准备和原生 ABI 准备与测试执行分离，同时确保本地命令在源码改变后仍安全准备。不能仅凭输出目录存在判断新鲜度。在添加自定义指纹前先评估现有构建工具的增量支持。
5. 仅当关键路径收益超过新增准备成本时，将 repository、types、lint、i18n 拆成独立 Ubuntu job。保留 `basic-checks` 作为失败关闭的汇总门禁。保留现有策略、迁移/生成漂移、语言、类型和 lint 检查；某组失败不能掩盖其他组失败。不全面增加进程内并发或取消内存限制。
6. 保留全部测试项目、平台契约和 package 产物测试。调整分片数量或 worker 分配前先测 renderer 分片失衡和模块加载时间。保留原生安全隔离。未经单独论证，不使用 `isolate: false`、替换类型检查器、移除 ESLint 规则或购买 runner。工具优先使用现有或预编译分发，不引入 setup 期间的源码编译。
7. 将实现推送到审阅分支，测量真实 CI，再基于证据进行第二轮优化。对比相同任务/项目范围、runner 标签和缓存状态，分别报告冷/热表现。包括失败/取消次数、墙钟耗时和 runner 秒数。保留不可比观察，但不据此宣称提速。

## Alternatives considered

- 把文章宣称的 20 倍提升作为目标：拒绝，其工作负载、runner 和预算不同；采用其测量方法。
- Markdown 跳过整个必需 workflow：拒绝，必需上下文可能 pending，且部分 Markdown 是运行时输入。
- 立即增加分片：拒绝，每片重复准备并竞争共享 runner 容量。
- 缓存全部安装/原生产物或关闭测试隔离：推迟，必须先有正确性和失效证据。
- main 继续共用默认 concurrency group：拒绝，关闭运行中取消仍会替换排队提交。

## Acceptance criteria

- AC1 — 原始 run/job/step 证据和逐 job 排队/准备/验证分解区分取消、未完成、内部准备、清理、依赖等待和缺失时间戳。（verification: 审计产物和 metrics 回归测试）
- AC2 — 连续 PR push 替换旧 PR 运行，多次 main push 则保留每个推送 head 的完整验证。（verification: workflow 契约测试和 GitHub 运行证据）
- AC3 — 纯文档 PR 不跑应用测试且三个必需上下文均完成；混合/运行时/未知改动保留覆盖，计划工作缺失、失败或取消会使门禁失败。（verification: validation planner、门禁测试及纯文档 CI）
- AC4 — 调度改变后，每个选中测试项目和现有策略/漂移/类型/lint/语言检查仍在清单中。（verification: 清单对比、workflow 契约测试及完整范围远程 CI）
- AC5 — 平台缓存由可信且与 main 兼容的运行填充，并按正确的锁文件/运行时/平台边界复用；删除或改变构建输入不能复用陈旧产物。（verification: 冷热 CI 日志及准备失效测试）
- AC6 — 连续本地准备和应用构建有逐阶段计时，重复准备均被移除或得到解释，且不削弱原生 ABI 正确性。（verification: 本地计时命令及定向准备测试）
- AC7 — 推送实现及后续优化后，报告可比的前后墙钟耗时、runner 秒数、排队/准备/验证耗时和样本量，不宣称无证据的提速。（verification: 真实 CI 运行及对比报告）

## Risks

并行 job 可能增加 runner 分钟数和竞争；main 完整验证比受影响 push 选择执行更多工作。迁移缓存会临时冷启动，并可能增加淘汰。不能盲目共享 Node/Electron ABI 原生产物。本地热运行时间不能预测托管 runner 时间。单次成功不足以证明稳定提速。实施前需要 Spec Approval；只有获批修改进入 main 后才能完整验证 main 缓存填充，因此仅有 PR 结果不能完成该验收项。
