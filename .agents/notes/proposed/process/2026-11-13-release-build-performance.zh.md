# Agent Note: 保留 USB 签名的发布构建性能优化

Status: proposed

[English](2026-11-13-release-build-performance.md) | 中文

## 问题

[发布工作流](../../../../.github/workflows/release.yml) 在每个操作系统上分别构建 Global 和 CN。每个 job 通过[根构建脚本](../../../../package.json) 重复执行完整类型检查和 JS 编译，再打包两种架构。Windows job 共用一台持久化签名机，私钥位于通过 Windows CSP 访问的 USB 令牌中。增加 runner 不会增加签名硬件。

[v2.2.1 运行](https://github.com/CherryHQ/cherry-studio/actions/runs/43229565814) 提供了诊断基线：两个 Windows job 串行运行，总计约 61.5 分钟。CN 保存 pnpm store 用了 7.95 分钟，Global 恢复 store 用了 6.58 分钟，而两个 job 的安装各自不到一分钟。Global macOS job 在进入 Vite 前花了约 11 分钟进行类型检查，main、preload 和 renderer 的 Vite 构建合计约 2 分 45 秒。这些是一次运行的观测值，不是预计提速。该运行早于当前直接上传 COS 的流程，其中归档下载的延迟不能代表当前传输性能。

[T3 Code 的发布工作流](https://github.com/pingdotgg/t3code/blob/5f85768394f417f5bd098ca7fe4fc41ef07a7cda/.github/workflows/release.yml) 将一次 JS bundle 构建与平台、架构打包分开。Cherry 需要区分 edition 的 bundle，并保留 USB 签名链。本决策负责发布打包优化；[CI 与本地验证提案](2026-10-01-ci-and-local-validation.md) 继续负责验证任务选择和调度。

## 提案

### 测量与发布信任

从 release 运行创建开始计时，直到完整且经过校验的草稿清单就绪，包含 runner 排队和准备时间。Environment 审批等待、发布和 GitCode 同步分别报告。优先使用 Actions job/step 时间戳；仅在这些时间戳无法区分原生准备、签名、公证和安装器生成时，在构建 hook 中增加具名计时段。记录成功或失败、源码 SHA、工作流 SHA、运行尝试次数、runner 类型、平台、架构、edition、缓存状态、产物大小和 runner 分钟数。缺失的计时保持未知，不记为零。

保留精确源码提交的成功 CI、分支与标签租约、完整清单校验、release Environment 审批和发布前复验。构建输入继续检出于 `expected_sha`；受信任的发布控制脚本继续固定到工作流 SHA。发布源码缺少所需构建接口时，在昂贵工作开始前报告不支持，绝不从 main 补入应用代码。

### 第一实现层：本地 store 与构建分离

持久化 Windows 签名 runner 使用本地 pnpm store，不通过 Actions 恢复或保存 store。仍执行 frozen-lockfile 安装，并保留现有依赖策略和生命周期脚本。现有 clean 输入可以删除 node_modules，而不清除 store。本层保持托管 macOS/Linux 的缓存行为。编译前清理源码输出目录，防止热检出带入旧文件。

将发布专用入口拆分为纯编译和纯打包，同时保留执行检查的开发构建命令。正式发布 job 使用精确源码提交的成功 CI 结果，不再重复执行完整类型检查。Preview 和 nightly 工作流在明确迁移前保持现有验证契约，不会隐式绕过类型检查。

### 第二实现层：edition bundle 与目标并行

在 Linux 上为 Global 和 CN 各构建一次 JS，包含 main、preload、全部 renderer 入口和 utility-process 入口。启用复用前审计构建时依赖平台的解析；需要在运行时判断的平台决策必须保留到运行时。每份 bundle 携带源码 SHA、edition、版本和摘要清单。打包只能使用同一次运行中成功生成且匹配的 bundle。缺失、篡改或不匹配时拒绝使用，不得静默重新编译。Sentry debug identifier 和 sourcemap 由对应 bundle job 生成和上传，保留现有上传失败策略。

原生模块、外部生产依赖、语音 helper、Computer Use runtime 和二进制选择仍由目标准备阶段负责。不将构建机的 node_modules 作为可移植应用依赖树分发。只有输入包含源码、补丁、锁文件、Electron 版本与 ABI、操作系统、架构、工具链和 Linux 兼容要求时，才缓存不可变的未签名原生产物。未命中时重新构建或使用现有已验证下载路径；命中时必须通过现有目标与产物检查。已签名应用和成功验证结果不属于原生缓存条目。

将 macOS 和 Linux 打包拆成 edition/架构 job，在现有兼容工具链支持时使用对应原生架构 runner。保留 Linux GLIBC 要求与固定原生产物校验。Windows 仍按 edition 各一个 job，在 USB 签名机上依次准备并打包两种架构。Windows 内部二进制先签名，再生成安装器，最后签署 setup 和 portable 容器。macOS 在分发前保留签名、公证和 stapling。

每个目标发布独立的运行/尝试/edition/平台/架构清单。聚合步骤将选定目标合并为[发布选择](../../../../scripts/release/select-release-upload.js)和 [COS 汇总](../../../../scripts/release/release-cos.py)消费的现有 edition/平台契约。文件名冲突时失败，不得覆盖。Updater manifest 按 edition 和平台合并，并验证两种架构的文件 URL、哈希和大小。目标失败或缺失时，不得生成完整草稿。单平台修复保留现有相同 SHA 基线规则；sync-only 使用已记录清单，不执行构建。最后更新[发布操作手册](../../../../docs/dev/contrib/release-workflow.md)。

### 推进顺序与可选 Windows 实验

第一、第二实现层分别交付，并在源码、目标清单、签名策略相同且 runner/缓存条件匹配时比较完整成功运行。冷、热结果分开报告，包含排队时间和 runner 分钟数；重复可比观测后，才宣称存在持续收益。历史样本不承诺数值提速。无法执行签名包、安装或更新检查时，明确保留为未验证 AC，不得用本地测试通过代替。

完成上述测量后，除非 Windows 仍决定草稿就绪时间且机器有空闲容量，否则保留单个 Windows runner。安装第二个 runner 是单独的运维决策，不属于以下实现 AC。此类实验需要独立 runner 与工作目录、围绕 USB 签名的机器级锁，以及等价的总耗时、签名、安装和更新检查。云签名、导出 USB 私钥以及将 Windows 签名迁到 Linux 均不属于本提案。

## 考虑过的替代方案

- 立即增加两个 Windows runner。暂缓：CPU/磁盘竞争和 USB/CSP 行为尚未测量，而重复缓存传输和类型检查已确认存在成本。
- 像 T3 Code 一样将 Windows 签名迁到 Linux。本范围内拒绝：必须继续支持现有 USB/CSP 签名安排。
- 全局删除检查，或复用其他 SHA 的成功结果。拒绝：只有精确源码提交的正式发布 CI 门禁可以替代重复类型检查。
- edition 共用一份 bundle，或跨平台复制 node_modules。拒绝：edition 配置与原生/runtime 依赖的归属不同。
- 不改变清单就拆分架构 job。拒绝：当前 COS edition/平台记录和共享 updater 文件名可能互相覆盖。
- 优先更换包管理器、压缩方式或分布式构建框架。暂缓，直到测量发现额外瓶颈。

## 验收标准

- AC1 — 每个选定目标报告准备/构建/上传计时与上下文，草稿就绪时间与审批等待、发布、同步明确区分；缺失阶段明确标记。（验证：工作流运行摘要和时间戳夹具；负责人：发布性能报告）
- AC2 — 正式发布在精确源码提交的 CI 失败或缺失、发布引用移动、清单不完整或缺少发布审批时无法发布；应用构建输入不得来自其他 SHA。（验证：定向发布工作流测试和发布控制运行检查；负责人：发布控制）
- AC3 — Windows 使用热本地 store 完成 frozen-lockfile 安装，无 Actions pnpm-store 传输，clean 模式仍重建有效依赖树。（验证：冷/热签名 runner 日志和 clean 模式运行；负责人：Windows 打包）
- AC4 — 正式发布编译不再重复完整类型检查，同时开发、preview、nightly 保留各自声明的验证行为；清理后的输出只包含当前构建。（验证：定向入口测试和构建日志；负责人：发布构建入口）
- AC5 — 每个 edition 在一次运行中仅编译一次 JS；打包拒绝缺失、篡改或源码/edition 错误的 bundle，打包后的错误通过对应已上传 sourcemap 正确解析。（验证：bundle 完整性测试、目标安装包启动检查和符号化测试错误；负责人：JS bundle 流水线）
- AC6 — 原生缓存无法跨不兼容的源码/工具链/ABI/操作系统/架构/兼容性输入复用，冷、热路径均生成可加载的目标原生产物。（验证：缓存失效测试和目标系统原生加载检查；负责人：原生打包）
- AC7 — 并行 macOS/Linux 目标 job 无冲突地产生完整现有发布清单；每个 edition 合并后的 updater manifest 保留两种架构的有效条目，局部修复和 sync-only 保持各自契约。（验证：定向清单/COS 测试、全平台运行和单平台修复运行；负责人：发布聚合）
- AC8 — 两个 edition 均保留已签名的 Windows 内部二进制与安装器、已公证/stapled 的 macOS 应用，以及全部受支持目标可用的安装、启动、utility process 和更新选择。（验证：签名/公证检查和打包后的安装/启动/更新场景；负责人：平台打包）
- AC9 — 冷/热运行比较明确标识源码、输出、runner/缓存条件、完整成功耗时、排队时间和 runner 分钟数；操作手册与交付行为一致，未验证的平台证据明确保留。（验证：可比工作流报告和文档检查；负责人：发布维护者）

## 风险

Linux 生成的 JS bundle 可能固化构建主机相关的解析；共享前必须确认可移植性。原生缓存遗漏任一输入都可能保留不兼容二进制。更多并行 job 可能增加准备成本、排队和 runner 分钟数。架构拆分会产生共享 updater 与 COS 清单的归属问题，必须先解决再启用并行上传。USB/CSP 访问和 Apple 公证仍是外部约束。新的发布入口必须先进入目标发布源码，控制工作流才能依赖它们。历史计时无法证明当前 COS 传输或其他 runner 配置下的收益。
