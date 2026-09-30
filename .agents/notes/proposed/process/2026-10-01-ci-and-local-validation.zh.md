# Agent Note: CI 与本地验证性能

Status: proposed

[English](2026-10-01-ci-and-local-validation.md) | 中文

## Problem

CI 和本地 coding agent 花费时间检查无关代码，但各自维护的任务清单又遗漏了部分 package 测试。本地命令还混合了检查、源码修复、构建和原生模块准备；多个 agent 同时执行会放大这些工作量，并竞争同一台机器的资源。

建议让本地验证与 CI 共用任务定义和改动分类，分别采用适合各自环境的并发策略。先修正选择范围和覆盖，再优化重检查与缓存。本文记录 2026-10-01 的调研；拟议命令和工作流改动均未实现，现有 agent 指令仍然有效。

## Evidence

### Scope and sampling

源码基线为 `3942cd2f700082745a80b94a78f3667db2d81887`，查询时与 main 一致。来源包括 [CI](../../../../.github/workflows/ci.yml)、[根脚本](../../../../package.json)、[Vitest 项目](../../../../vitest.config.ts)、[workspace 配置](../../../../pnpm-workspace.yaml)及 [Git hooks](../../../../.pre-commit-config.yaml)。

从调研时获取的最近 100 次 CI 中，选取最近 30 次成功运行。创建时间范围为 2026-09-30 09:48:38–15:55:38 UTC，即 Asia/Shanghai 17:48:38–23:55:38，其中 PR 20 次、push 10 次。job 和 step 耗时来自 GitHub Actions 最近一次 attempt 的时间戳；失败、取消和未完成运行不计入耗时统计。这是当日基线，不是长期基准，也不代表本机性能。

| 测量项 | 样本数 | 中位数 |
| --- | --- | --- |
| Basic checks job 执行 | 30 | 363 秒 |
| 从 run 创建到 basic checks 启动 | 30 | 3 秒 |
| I18N Translation Check | 30 | 123 秒 |
| Read-only Checks 并行组 | 30 | 158 秒 |
| PR basic checks 恢复依赖缓存 | 20 | 35.5 秒 |
| Basic checks 安装依赖 | 30 | 20.5 秒 |
| macOS 测试恢复依赖缓存 | 24 | 140 秒 |
| macOS Main and Package Tests 步骤 | 24 | 45 秒 |

30 次中有 21 次 basic checks 是最后完成的成功 job，耗时范围为 267–420 秒。各步骤中位数来自不同分布，不能直接相加视为某次运行的总耗时。macOS 测试步骤还包含 native 准备，并非纯测试执行时间。

[Backup PR 的 basic job](https://github.com/CherryHQ/cherry-studio/actions/runs/36740345816/job/109972792418)提供了一个代表性拆解：

- i18n sync 和 validation 合计约 2 秒，unused-key 分析约 121 秒。
- 后续 lint 分支约 156 秒，其中 Oxlint 约 56 秒、ESLint 约 100 秒。
- 类型检查接硬编码字符串检查约 122 秒，与 lint 并行；docs 检查约 7 秒。
- 恢复的 Linux pnpm 缓存约 2,342 MB；缓存命中仍需传输和解压。

[Main push](https://github.com/CherryHQ/cherry-studio/actions/runs/36740426367) 和[仅修改工作流的 PR](https://github.com/CherryHQ/cherry-studio/actions/runs/36700773347)也体现了全仓检查的成本。原始 API 响应和日志保存在调研工作区被忽略的 `.context/ci-research/` 下；本文保留结论和公开证据，不依赖这些本地文件才能阅读。

### Why documentation still incurs expensive CI

`basic-checks` 不依赖改动分类，所有满足条件的非草稿 PR 都运行全仓检查。测试 job 虽然有路径过滤，但 `src/main/**`、`src/renderer/**` 及 package glob 包含同目录 README。向配置分支的每次 push 又通过无条件 push 分支绕过过滤。

[PR 16462](https://github.com/CherryHQ/cherry-studio/pull/16462) 只修改了 `docs/` 下九个 Markdown 文件。观察时，其 [CI](https://github.com/CherryHQ/cherry-studio/actions/runs/36741982750) 已跳过单元测试，而 basic checks 仍在运行；这里没有记录它的最终结果。

[PR 20990](https://github.com/CherryHQ/cherry-studio/pull/20990) 修改两个内置 skill Markdown 文件。[PR 运行](https://github.com/CherryHQ/cherry-studio/actions/runs/35910375405)跳过测试，[合并后的 push](https://github.com/CherryHQ/cherry-studio/actions/runs/35957469812)则运行全部十个测试分片。内置 skill 属于运行时资源，因此这个例子证明事件类型影响选择，不能据此认为它的所有测试都可删除。

### Basic checks are serialized around global scans

[Unused-key 分析](../../../../scripts/i18n-check-unused.ts)使用 ts-morph 解析 renderer、main、shared 和 package 源码。Main 源码同时参与 renderer catalog 分析及独立的 main catalog 分析。CI 等整个步骤结束后，才启动 lint/type/docs 并行组。

并行组内的 typecheck 项目被显式串行化，因为 ESLint 与多个类型检查进程并发曾导致 runner OOM。不能直接删除限制来宣称优化。ESLint 使用了 `--cache`，但工作流持久化的是 pnpm store，没有持久化 ESLint 结果缓存。

### Test coverage differs across entry points

| 任务或 package | 观察到的覆盖缺口 |
| --- | --- |
| 根 `test` | 包含 UI 和 preload，但未枚举 remote package 测试 |
| 根 `ci:test-check` | 包含 remote package，但遗漏 UI 和 preload 项目命令 |
| 主 CI 与 remote package | 没有 remote-protocol、remote-transport 的 filter 或根 Vitest project；独立测试另在 [package 发布工作流](../../../../.github/workflows/release-packages.yml)中运行 |
| dsh-bridge | 有独立测试，但没有对应的主 CI filter/project |
| ai-sdk-provider | 改动会触发 aiCore/main/renderer，但 aiCore 项目只收集 `packages/aiCore/**`，provider 自身测试未被选择 |

这些是测试发现与编排缺口，不代表消费方完全没有集成覆盖。构建成功也不等于执行了 package 的测试。

### Local command contracts amplify concurrent work

根 package 有 105 个脚本，其中平台、架构、版本组合的构建别名有 18 个。数量反映维护负担，真正影响性能的是以下行为：

| 入口 | 当前行为与影响 |
| --- | --- |
| `lint` | 修复全仓代码，运行全部类型检查和 i18n 校验，再格式化全仓。小改动也触发广泛检查，并可能修改无关文件。 |
| `typecheck` | 先构建 ai-sdk-provider，再并行启动 node、web、aiCore、e2e 检查。构建配置为 `clean: true`，会重写 `dist`。 |
| Vitest | `maxWorkers: '50%'` 作用于每次调用，不是全部 agent 的总预算。多个 worktree 可各自申请整机一半可用并行度。 |
| `test` | 串联三次 Vitest 调用；追加文件参数不能约束前面的调用。 |
| `test:scripts` | 使用 `vitest scripts` 路径过滤，而非明确 project 和 run 模式；交互执行可能进入 watch。 |
| `postinstall` | 构建 dsh-bridge 及两个 remote package；安装依赖同时承担构建准备。Checkout/merge hook 可触发安装。 |
| `dev` 与 main 测试 | 在同一个 binary 槽位准备不同的 better-sqlite3 ABI，同一 worktree 内并非独立任务。 |

不同 worktree 主要竞争 CPU、内存和 I/O。同一 worktree 内并发执行还会共享可变构建产物、缓存及 native binary。本轮没有进行本地多 agent 负载基准或冲突复现；资源竞争机制由命令结构支持，但本机减速比例尚未测量。

Node/web tsconfig 已启用增量编译，并使用不同的 `.tsbuildinfo` 文件，不能把“启用增量”当作缺失功能。[二进制下载器](../../../../scripts/download-binaries.js)已有按版本共享的缓存，不能未经测量就假设每次都重复下载。Native 边界见 [ABI 契约](../../../../docs/references/testing/database-testing.md#better-sqlite3-native-module-abi)。

## Proposal

### Shared task definitions with separate execution policies

每项检查、测试项目和必要准备任务只定义一次，本地命令与 CI 共用覆盖规则。`package.json` 保留易读入口，优先使用现有 pnpm/Vitest 能力，再考虑编排代码。不为获取任务依赖图而搬迁应用目录或新建 package。

以下接口均为提议，尚不可使用：

| 层次 | 候选接口 | 契约 |
| --- | --- | --- |
| 单项任务 | `lint:check`、`lint:fix`、`format:check`、`format:write`、`typecheck:node`、`test:renderer` | 单一职责、范围明确、参数转发可预测；源码检查不修复源码 |
| 本地日常验证 | `check`、`check --plan` | 选择受影响任务并解释原因，限制并发 |
| 完整验证 | `check:all`、CI 调度 | 复用任务定义，执行全量或选中的 CI job 与分片 |

源码检查可更新可丢弃缓存；清理或写入 package 产物的准备任务必须保留为显式依赖。先核实 provider 生成的必要性，再决定是否移除。建立包含独立 package 的唯一测试清单，确保每个应执行测试都有执行路径。

实现时同步更新 AGENTS.md 和开发说明，否则目前要求运行全仓 `pnpm lint` 的指令仍会让 agent 走重路径。现有公开脚本名及 CI 消费方要保留或明确迁移，不能静默改变语义。

### Change classification

| 改动输入 | 建议检查 |
| --- | --- |
| 普通文档及源码目录 README | 格式与 docs 校验 |
| 开发 skill 文件 | 格式、skill 一致性及适用文档校验 |
| 内置 prompt、skill、运行时资源 | 相关生成物和资源契约检查及测试 |
| Renderer 代码 | 相关 lint/i18n、web 类型、renderer 测试 |
| Main 或 preload 代码 | 相关 lint/i18n、node 类型、main/preload 测试及 renderer 消费方检查 |
| Shared 代码或公共 package | 自身检查及测试，加上受影响的消费方 |
| 全局依赖、配置或测试基础设施 | 所有受影响项目，保守扩大范围 |
| 未识别的代码或资源路径 | 明确显示保守回退，并提示补充分类 |

本地选择必须包括分支改动、暂存与未暂存修改、未跟踪文件、删除和重命名。PR 使用完整 PR 差异，push 使用本次推送范围。最后一次提交只改文档，不能遮蔽范围内更早的代码改动。缺失比较历史或分类失败不能产生空的成功计划。

不能排除全部 Markdown：运行时 prompt 和 fixture 文档也是有效输入。Docs 检查成本低，还应覆盖可能破坏链接及 frontmatter `sources` 的删除和移动。

明确保留跨进程依赖边，包括 preload 声明和 shared 契约。类型检查应选择完整的受影响项目，不能只把几个改动文件交给 `tsc` 而绕过项目配置。Unused-i18n 校验既响应 locale 改动，也响应源码引用改动。数据库和生成器检查应同时包含输入与已提交输出。

### Local concurrency and preparation

先以一次一个重任务、每次本地调用使用少量固定测试 worker 作为测量起点，基准完成前不把参数视为最终默认值。同时限制外层任务并发和内部 worker；只限制外层不能约束 Vitest 或编译器工作量。

准备任务在一次计划内复用。缓存及可变产物默认限定在 worktree 内；跨 worktree 共享需要明确的不可变键与安全发布契约。不能只按 HEAD 去重验证结果，agent 可能有不同的未提交输入。避免对同一安装目录并发进行 Electron/Node ABI 准备。

先测 typecheck 冷热缓存、provider 构建必要性和安装副作用，再修改实现。整理发布别名的优先级低于修复高频验证入口。

### CI scheduling and gates

普通文档在 PR 和 push 都走轻量路径。将重 lint、typecheck、i18n 拆为可独立调度的 job；在确定分组前评估额外 checkout/install 成本。便宜的格式、docs、生成器检查在适合时保持合并。

先保留 Linux main 和 renderer 当前分片数作为基线。更多分片会复制大缓存恢复和安装成本，平台 job 已有大量依赖准备开销。按平台敏感模块及其依赖选择 macOS/Windows 工作，不能只检查改动文件是否包含 `process.platform`。保留 main 测试适合 native module 的进程池。

取消被新提交替代的 PR 运行，concurrency 按工作流及 PR 隔离。不要自动将取消策略扩展到发布工作流。保留手动全量验证并增加定时全量验证作为兜底；它们都不能代替受影响改动必须执行的检查。

调研时，[main rules 接口](https://api.github.com/repos/CherryHQ/cherry-studio/rules/branches/main)要求 `basic-checks`、`general-test`、`render-test`。除非明确迁移消费方，否则保留这些名称作为汇总门禁。门禁必须校验计划内任务结果，并拒绝分类失败、必需任务失败或取消、无法解释的跳过。明确声明的空计划可以通过，证据缺失不能通过。

### Further optimization candidates

选择和覆盖正确后，再测 ESLint 结果缓存、i18n 按文件内容缓存解析结果。缓存失效必须包含工具版本、配置及相关依赖。硬编码字符串检查可研究按改动文件执行；全局 unused-key 检查仍需要完整引用集合。

仅在依赖模型足够的范围试点 Vitest related-test 选择。动态 import 和通过文件系统加载的资源需要显式输入。覆盖范围等价的对比完成前，不承诺节省比例。

## Implementation plan

2026-10-01 授权通过 stack PR 实现。按依赖拆成三层：

1. 测试清单：补齐独立 package 的根 Vitest 项目，统一完整测试入口及明确 run 模式。
2. 本地验证：共用任务与分类规则，实现 `check`、`check --plan`、`check:all`；将 lint 检查和修复分开，默认串行重任务、本地两个测试 worker，并更新开发指令。
3. CI 调度：复用分类结果，拆分 repository、lint、types、i18n，选择测试项目，保留三个必需汇总检查，取消旧 PR 运行。

保留旧聚合命令作为兼容入口，不再各自维护任务列表。第一版代码 lint 仍保守执行全仓检查；typecheck 选择完整项目；格式和 docs 保持便宜的全仓检查。缓存、文件级 lint/related-test 及更细的平台选择留待等价覆盖下的测量，不在本轮承诺收益。每层独立提交和验证，上层 PR 以相邻下层为 base，底层以 main 为 base。

## Alternatives considered

- **工作流顶层 `paths-ignore`。** 不用于必需工作流：GitHub 可能让被跳过工作流的必需检查保持 Pending。优先显式计划和汇总门禁。
- **排除全部 Markdown。** 拒绝，因为内置 skill、prompt 和 fixture 会影响运行行为。
- **默认增加 job、分片或无限并发。** 拒绝作为默认方向：准备成本、本地资源竞争及历史 CI 内存限制都需要测量。
- **只依靠 `vitest related` 或 package filter。** 无法完整覆盖动态及文件系统输入，也不能独自表达根 package 内的 main/renderer/shared 边界。应在能力边界内使用现成工具。
- **立即引入 Nx、Turborepo 或整机 agent 调度器。** 暂缓。先建立任务契约、测量现有 pnpm/Vitest 控制；框架不会自动修复依赖声明和测试遗漏。
- **只重命名脚本或把 shell 链搬到一个大脚本。** 不足以解决覆盖重复、隐式写入及资源归属问题。
- **本地与 CI 继续分别维护任务清单。** 拒绝，现状已经漂移。执行策略可以不同，覆盖定义应共用。

## Acceptance criteria

| 阶段 | 工作 | 验证 |
| --- | --- | --- |
| 1 | 统一清单、改动分类、文档路径、补齐 package 测试、取消旧 PR 运行 | 重放代表性历史文件集，证明各 package 测试被选中，门禁语义仍正确 |
| 2 | 本地命令契约明确化和限制并发 | 文件参数只进入目标项目；检查模式不改 tracked 源码；指令与命令一致 |
| 3 | CI 重检查独立调度、复用准备 | 对比等价 CI 的总耗时、runner 分钟数、准备时间和失败情况 |
| 4 | 缓存和更细依赖选择 | 验证冷热失效、删除及重命名、资源改动，不复用过期成功结果 |

选择规则的场景必须包括普通文档、源码 README、运行时 Markdown、main-only、renderer-only、shared、每个独立 package、preload 契约、locale、migration、scripts、根依赖及配置、未知路径、混合改动、删除、重命名、未跟踪输入和缺失 git 历史。计划内 job 失败或取消必须让门禁失败；有意不执行任务必须可见。

本地基准对比一个、两个、四个独立 worktree，覆盖冷热缓存及代表性小改动。记录单任务与全部 agent 完成时间、worker/进程数、峰值内存及内存压力、CPU 使用率、准备时间和附带写入。共享机器的测量需选择受控时间窗口，本轮调研没有运行此类负载测试。根据整体吞吐与响应性选择默认值，不先承诺百分比收益。

## Risks

过窄的依赖映射会漏回归。跨文件 lint 规则和全局 i18n 引用限制了简单的 diff-only 执行。拆 job 可能缩短等待却增加 runner 分钟数。缓存键可能保留过期成功，可共享写入的产物可能产生竞争。脚本改名可能破坏 hook、skill 或外部使用者。定时全量通过不证明后续 PR 或打包运行时正确。

本方案仍需实现评审和测量。上述实现授权覆盖验证工具和 CI；package 边界调整、工具链替换和缓存实验仍不属于本 stack。

## References

- [pnpm filtering](https://pnpm.io/filtering) 与[递归执行](https://pnpm.io/cli/recursive)：package/依赖选择及并发。需按仓库固定的 pnpm 12.6.0 验证语义，当前在线文档也包含更新版本行为。
- [Vitest related tests](https://vitest.dev/guide/cli.html#vitest-related) 与 [worker 限制](https://vitest.dev/config/maxworkers)：静态依赖边界和单次调用的 worker 控制。
- [TypeScript 增量编译](https://www.typescriptlang.org/tsconfig/incremental.html)：现有项目缓存行为。
- [GitHub 工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)：过滤、并发及跳过必需工作流的行为。
- [文档治理提案](2026-08-18-docs-governance-and-spec-workflow.zh.md)：本 proposed Agent Note 的归属，以及工作流实际执行与本地脚本别名的区别。
