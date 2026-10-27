# Agent Note: 退役 ESLint 执行链路

Status: proposed

[English](2026-10-27-eslint-retirement.md) | 中文

## Problem

[根脚本](../../../../package.json)、workspace 脚本、[Git hooks](../../../../.pre-commit-config.yaml) 和[编辑器设置](../../../../.vscode/settings.json) 仍在 Oxlint 之外运行或推荐 ESLint。两个引擎的忽略范围、覆盖配置、抑制指令名称和失败策略不同。未迁移这些契约就删除 ESLint 命令，会静默丢失检查。

在源码基线 `9d8c53e4ab4c87ee13c0b8def9f97c4f5cfd921e` 上，对 tracked JS/TS 文件解析本地 ESLint 配置，得到 8,937 个适用文件、25 组不同的启用规则及选项，以及 80 个启用规则名称：51 条 React 规则和 29 条其他规则。这些数量描述的是该修订及本地环境，不是永久规则清单，也不能证明 CI 覆盖。

之前的[退役 PR](https://github.com/CherryHQ/cherry-studio/pull/17722) 已关闭，未合并。其中的[基准](https://github.com/CherryHQ/cherry-studio/pull/17722#issuecomment-5618465733) 记录了更快的冷启动 lint 路径，但本地热缓存中位数慢了 29%。该测量及其规则映射均不能代表当前行为。

一次隔离的 macOS arm64 实验使用 Oxlint 1.90.0 与现有 `@eslint-react/eslint-plugin` 1.53.1。全部 51 条启用的 React 规则都有违规对照。对 14 个 fixture 文件合并运行后，与 ESLint 9.39.5 产生相同的 70 条诊断，包括规则、文件、位置、消息和严重度；合法 fixture 没有诊断。实验只适配了插件规则名称。这不验证其他规则、自动修复、生产文件范围、其他平台或性能。实现阶段必须把有价值的案例变成仓库维护的回归测试，不能依赖 gitignored 实验产物。

## Proposal

### Scope and ownership

让 Oxlint 成为仓库唯一的 lint 执行引擎。退役根目录及 workspace 的 ESLint 命令、`eslint.config.mjs`、ESLint 专用编辑器操作与推荐，以及 ESLint fix hook。删除仅服务于退役引擎或配置的直接依赖。保留公开 lint 命令名称、只读与修复行为、显式文件参数，以及现有验证规划器和 CI 门禁结构。

本方案部分接替[CI 与本地验证性能](2026-10-01-ci-and-local-validation.md) 中的双 lint 引擎选择。原文继续负责任务选择、编排、并发和 CI 观测。本迁移不改变这些策略，不将 TypeScript 替换为 tsrs，不移除仍被独立使用的 TS5/TS6 API，不重写业务行为，也不升级 React 规则语义。

允许保留 ESLint 兼容规则包作为 Oxlint 插件。间接 `eslint` peer dependency 不是执行回退：必须列出其依赖归属，并与直接依赖、实际命令执行区分。包名包含 `eslint` 的依赖数量归零不是验收条件。

### Rule migration

使用根 Oxlint 配置，以及 `scripts/lint/` 下由仓库维护的 JS 插件模块。初期将当前 React 插件固定为 1.53.1。优先使用现有兼容插件实现和经过验证的原生等价规则；保留选项、warning/error 行为、修复、例外和文件范围。只有原生或兼容插件无法保留契约时，才移植本地规则。不得不经当前源码对照就复制历史 PR 实现。

覆盖现有 Oxlint 规则及每一条实际生效的 ESLint 规则和覆盖配置，包括当前零违规的文件。非 React 覆盖包括 Hooks、未使用导入、Zod 导入、受限语法/导入/全局变量、renderer/shared/main/package 与 utility-process 边界、seeder 写入、路径品牌、生命周期、事务 helper、i18n、七条 barrel 规则、命名、schema key 和高亮边界。保留 `ModelService` 与 `ProviderRegistryService` 的事务选项、显式 public-barrel 导入、测试排除和动态 page/barrel 发现。

原生规则名称本身不是充分证据。实验中，`react/no-react-children` 还禁止了刻意允许的 `Children.toArray`，原生 `react/no-clone-element` 则漏报动态导入案例。React 插件 5.28.8 为 `no-implicit-key` 引入了 typed-parser 要求，移除了部分旧规则，并改变了 class-component 检查。插件升级与引擎退役分开进行。

### Failure policy and suppression migration

现有根命令先以 `--deny-warnings` 运行 Oxlint，再运行没有 warning 数量限制的 ESLint。保留实际退出行为：当前会阻断的 warning 仍阻断，ESLint 顾问级 warning 仍保持顾问级。删除全局 warning 开关前，将现有阻断规则表达为 error；必须包含启用的默认规则，而不只是显式配置规则。保留 `CI` 和 `RENDERER_PAGE_SIBLING_ERROR` 的严重度差异，并在独立进程中测试。

将生效的行内指令迁移到对应 Oxlint 规则 ID，同时保留范围和理由。测试文件级、下一行、区块、多规则和有意例外场景。历史说明、外部示例、patch 内容和生成文件的所属输入，除非属于实际执行输入，否则保持不变。需要时通过生成器更新产物，不能手改。防止规则 ID 被静默忽略或抑制范围扩大。

### Integration and verification

根命令、aiCore、UI、extension-table-plus、图标生成、暂存文件 hook 和编辑器操作，必须以既有文件范围及写入意图访问同一份维护中的 lint 配置。同步更新生效的开发者指令及受影响的双语参考文档。保留当前 Oxlint 类型感知规则和其支持的运行时依赖；退役 ESLint 不意味着退役 `oxlint-tsgolint`。

针对生产配置构建聚焦的合法/违规 fixture，包括范围外路径和覆盖配置，不使用独立的测试专用规则配置。增加退出状态和安全修复案例；测试必须能因真实漏报、误报或文件选择错误而失败。通过显式规则映射比较基线与候选诊断，并审查有意的位置差异。最终层不得包含未经审查的严重度降低或规则缺失。

本地测试使用显式测试文件路径，lint/format 检查限定到变更范围。全仓覆盖使用现有 CI 完整 lint 门禁，并在 Linux、macOS 和 Windows 运行聚焦的插件/CLI 测试。配置、插件、package、lockfile 和 fixture 的改动必须选择这些测试。在受控冷热运行中测量等价的基线/候选 lint 范围，报告缓存定义、重复次数、版本、退出状态和附带写入。不根据 React fixture 运行宣称提速；明显的性能回退必须在最终层之前获得明确的取舍决定。

## Alternatives considered

- 长期保留双引擎命令：可保持兼容，但继续留下重复执行和配置；仅在迁移过程中保留。
- 立即把全部 React 规则替换为原生规则：拒绝，因为当前 fixture 已暴露覆盖变化。
- 在升级 Oxlint 的同时升级 React 插件：拒绝，因为它引入独立的 typed-parser 与语义变化。
- 本地重写全部插件规则：拒绝，因为这会重复上游维护，并且此前已造成等价性缺口。
- 要求零间接 ESLint/TypeScript 包：本范围内拒绝；依赖/API 退役需要独立的消费者证据。

## Acceptance criteria

- AC1 — 每一条启用的基线规则、选项、默认行为、环境敏感严重度、文件范围及抑制指令都有维护中的去向；合法/违规及范围外 fixture 能检测覆盖丢失或扩大，包括全部 51 条 React 规则和事务 helper 例外。（verification: lint 迁移负责人；显式 scripts 测试文件及经审查的诊断对照）
- AC2 — 根/workspace 的 lint、fix、图标生成、hooks、编辑器设置和 CI 执行 Oxlint，不调用 ESLint；移除仅供引擎使用的直接依赖及配置，并记录任何间接 ESLint 的归属。只读命令不编辑 tracked 源码，修复命令保留预期安全修复及文件参数范围。（verification: 集成负责人；依赖审计、命令/退出/修复测试及 tracked-file diff）
- AC3 — 阻断性的 Oxlint warning、顾问级 ESLint warning 和本地/CI 覆盖配置保留实际退出行为；重命名后的指令只抑制目标规则及范围。（verification: lint 迁移负责人；隔离环境与抑制指令回归测试）
- AC4 — 聚焦测试在 Linux、macOS 和 Windows 通过，任何迁移输入改动都会选择这些测试；必需 CI 门禁名称和验证编排保持不变。（verification: CI 负责人；规划器 fixture 及精确 head 的平台 job 结果）
- AC5 — 可比较的冷热基线与候选测量报告范围、缓存状态、版本、重复次数、失败及附带写入；完成前，对任何明显回退都有明确接受的取舍。（verification: 迁移负责人和评审者；受控 benchmark 报告）
- AC6 — 生效指令及受影响参考文档描述仅由 Oxlint 执行的路径，双语配对保持同步，最终实现层把每个 AC 映射到实际证据后再将本 note 移到 implemented。（verification: 文档负责人；文档影响审查、docs 门禁及 Agent Note 迁移检查）

## Risks

JS 插件 API 仍处于 alpha。插件加载成功不能证明诊断或自动修复等价。别名解析、动态目录发现、忽略优先级和环境敏感严重度，都可能在现有代码不报错的情况下丢失约束。JS 插件可能减少冷启动成本，却使本地缓存场景回退。保留的插件 peer dependencies 和 Compiler API 消费者，可能使旧包在停止执行 ESLint 后仍留在依赖中。

本 Spec 必须在精确 head 上获得 Approval 后才能开始实现。如果某条规则无法保留，应保持迁移未完成，并把具体行为变化带回本 Spec；不能通过删除规则来获得绿色门禁。
