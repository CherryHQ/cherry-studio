# v1 社区版移植企业版 PowerShell 支持交付差异清点

## 目标

把企业版已经验证的 Windows PowerShell Agent 支持移植到 v1 社区版：有效 Git Bash 继续优先；Git Bash 缺失时使用 Windows 系统 PowerShell；Agent 创建不再被 Git Bash 硬门禁阻断。

最终实现使用 Claude Agent SDK 的平台原生二进制，显式打包独立 ripgrep，维持现有代理与跨平台边界，并完整呈现 PowerShell 工具授权、调用和输出。企业登录、品牌、版本号、CI、PowerShell 7 捆绑和数据模型变更不在范围内。

## 执行审计日志

| 顺序 | 时间戳 | 阶段 / 门禁 | Agent / Reviewer | 结果 | 证据 / 后续 |
|---|---|---|---|---|---|
| 1 | 2026-07-31T18:19:54+08:00 | 计划提交 | 主执行者 | 已提交 | `docs/plan/port-enterprise-powershell-support-v1.md`；用户已明确批准执行 |
| 2 | 2026-07-31T18:22:10+08:00 | 阶段 0 分派 | `/root/stage0_packaging`、`/root/stage0_binaries`、`/root/stage0_runtime` | 并行启动 | P0.1 独占依赖/打包；P0.2 独占 binary resolver/ripgrep；P0.3 独占 native SDK 启动/API 兼容 |
| 3 | 2026-07-31T18:34:49+08:00 | 阶段 0 验证 | `/root/stage0_validation` Validation Reviewer | PASS | clean context；D1、D3–D5、D8、阶段验收、分派证据与解包产物均满足，无阻塞项 |
| 4 | 2026-07-31T18:35:19+08:00 | 阶段 0 提交 | 主执行者 | 已提交 | `feat(agents): adopt native Claude runtime`；签署提交；工作树干净 |
| 5 | 2026-07-31T18:37:11+08:00 | 阶段 1 分派 | `/root/stage1_shell_env`、`/root/stage1_runtime_wiring`、`/root/stage1_agent_modal` | 并行启动 | P1.1 独占 shell/env helper 与 Git Bash 清理；P1.2 独占 ClaudeCodeService 接线；P1.3 独占 AgentModal/test/i18n |
| 6 | 2026-07-31T18:44:29+08:00 | 阶段 1 集成修复 | `/root/stage1_shell_env` Fixer | 修复中 | `pnpm build:check` 仅发现 process test mock 类型 TS2339；交回原 owner 窄修复，产品代码无类型错误 |
| 7 | 2026-07-31T18:48:34+08:00 | 阶段 1 验证 | `/root/stage1_validation` Validation Reviewer | PASS | typed mock 修复后全量 `pnpm build:check` 通过；D2、D5–D8、分派和边界均满足，无阻塞项 |
| 8 | 2026-07-31T18:49:16+08:00 | 阶段 1 提交 | 主执行者 | 已提交 | `feat(agents): fall back to PowerShell on Windows`；签署提交；工作树干净 |
| 9 | 2026-07-31T18:51:04+08:00 | 阶段 2 分派 | `/root/stage2_backend_tools`、`/root/stage2_message_rendering`、`/root/stage2_tool_settings` | 并行启动 | P2.1 独占后端 metadata/catalog/runtime filter；P2.2 独占消息路由/终端卡片；P2.3 独占 ToolsSettings/test/i18n |
| 10 | 2026-07-31T19:03:30+08:00 | 阶段 2 验证 | `/root/stage2_validation` Validation Reviewer | PASS | P2.2 provider 前缀路由由原 owner 窄修复；D1、D6、D8、D9 与全部阶段门禁满足，无阻塞项 |
| 11 | 2026-07-31T19:04:04+08:00 | 阶段 2 提交 | 主执行者 | 已提交 | `feat(agents): render PowerShell tools`；签署提交；工作树干净 |
| 12 | 2026-07-31T19:07:33+08:00 | 计划符合性 | `/root/plan_conformance` Plan Conformance Reviewer | FAIL | D6/P1.3 遗留未使用但矛盾的 `agent.gitBash.error.*`/`notFound` required 文案，阻止最终 Review |
| 13 | 2026-07-31T19:07:33+08:00 | 符合性修复 | `/root/stage1_agent_modal` Fixer | 修复中 | 交回原 locale owner 删除 12 个语言文件中的废弃 required-only Git Bash error/notFound 键，保留 optional tooltip 与 PowerShell keys |
| 14 | 2026-07-31T19:11:02+08:00 | 符合性修复提交 | 主执行者 | 已提交 | `fix(agents): remove obsolete Git Bash required copy`；12 个 locale 删除 84 行废弃文案；format/build:check 通过 |
| 15 | 2026-07-31T19:11:02+08:00 | 计划符合性复审 | `/root/plan_conformance` Plan Conformance Reviewer | PASS | D6 gap 已闭合；完整 `origin/v1...HEAD`、D1–D9、分派、非目标与验证账本满足 |
| 16 | 2026-07-31T19:13:28+08:00 | 最终代码 Review 第 1 轮 | `/root/final_review_runtime_r1`、`/root/final_review_renderer_r1`、`/root/final_review_crosscut_r1` | 并行审查中 | full mode；runtime/packaging、renderer/UX、cross-cutting 三个 clean-context 独立视角 |
| 17 | 2026-07-31T19:21:30+08:00 | 最终代码 Review 第 1 轮结论 | 三位 Reviewer | MUST_FIX_FOUND | 去重 2 项：native Claude 未清理 `BUN_OPTIONS`；非 Windows 设置更新会写丢 opaque `PowerShell` ID；无 decision-impact |
| 18 | 2026-07-31T19:21:30+08:00 | 最终 Review 修复分派 | `/root/stage1_shell_env`、`/root/stage2_tool_settings` Fixer | 并行修复中 | 原 owner 分别修 BUN launcher env 与 ToolsSettings/PermissionModeSettings opaque ID 写回，并补目标测试 |
| 19 | 2026-07-31T19:26:39+08:00 | 最终 Review 修复提交 | 主执行者 | 已提交 | `fix(agents): preserve native runtime boundaries`；目标 tests、`pnpm format`、`pnpm build:check`、`git diff --check` 均通过；全量 260 files/4615 tests passed，72 skipped |
| 20 | 2026-07-31T19:27:54+08:00 | 最终 Review 修复复核 | `/root/final_review_runtime_r1`、`/root/final_review_crosscut_r1` 原 Reviewer | 定向复核中 | 仅核查各自原始 finding、修复 diff 与直接调用点，输出 CLOSED / STILL_OPEN / DOWNGRADED_TO_EDGE |
| 21 | 2026-07-31T19:29:23+08:00 | 最终 Review 修复复核结论 | 两位原 Reviewer | CLOSED | runtime reviewer 确认继承/注入两条 `BUN_OPTIONS` 路径关闭；cross-cut reviewer 确认两处设置写回保留 opaque ID，且可见性、授权边界与其他 stale ID 清理未回归 |
| 22 | 2026-07-31T19:29:23+08:00 | 最终代码 Review 第 2 轮 | 三位新 clean-context Reviewer | 并行审查中 | full mode；基于包含第 1 轮修复的完整 `origin/v1...HEAD` 重新独立审查 |
| 23 | 2026-07-31T19:41:09+08:00 | 最终代码 Review 第 2 轮结论 | 三位 Reviewer | MUST_FIX_FOUND | 去重 2 项：Claude 认证/后端选择 env 未被托管边界清理；`builtin_*` 未知 provider tool 绕过通用 renderer；runtime reviewer PASS，无 decision-impact |
| 24 | 2026-07-31T19:41:09+08:00 | 第 2 轮 Review 修复分派 | `/root/stage1_shell_env`、`/root/stage2_message_rendering` Fixer | 并行修复中 | 原 owner 分别补齐托管 env 清理/拒绝与 provider 前缀 fallback，并补继承/注入和路由目标测试 |
| 25 | 2026-07-31T19:47:33+08:00 | 第 2 轮 Review 修复提交 | 主执行者 | 已提交 | `fix(agents): harden Claude runtime boundaries`；目标 110 tests、`pnpm format`、`pnpm build:check`、`git diff --check` 通过；全量 260 files/4631 tests passed，72 skipped |
| 26 | 2026-07-31T19:47:43+08:00 | 第 2 轮 Review 修复复核 | `/root/final_review_crosscut_r2`、`/root/final_review_renderer_r2` 原 Reviewer | 定向复核中 | cross-cut reviewer 复核托管 Claude env；renderer reviewer 复核 `builtin_*` provider fallback；仅检查原 finding 与直接调用点 |
| 27 | 2026-07-31T19:53:20+08:00 | 第 2 轮 Review 修复复核结论 | 两位原 Reviewer | 1 CLOSED / 1 STILL_OPEN | renderer fallback 已 CLOSED；Claude 直接 provider 选择器已关闭，但 native runtime 的 remote agent-proxy/WebSocket env 仍能改写请求端点，属于同一 finding 未闭合 |
| 28 | 2026-07-31T19:53:20+08:00 | 第 2 轮 Review 二次修复分派 | `/root/stage1_shell_env` Fixer | 修复中 | 补充 remote/agent-proxy/session-ingress 启用、端点、session 与认证变量的继承清理和 Agent 注入拒绝，并补大小写/输入边界测试 |
| 29 | 2026-07-31T19:57:55+08:00 | 第 2 轮 Review 二次修复提交 | 主执行者 | 已提交 | `fix(agents): block remote runtime overrides`；目标 128 tests、`pnpm format`、`pnpm build:check`、`git diff --check` 通过；全量 260 files/4659 tests passed，72 skipped |
| 30 | 2026-07-31T19:58:01+08:00 | 第 2 轮 Review 二次修复复核 | `/root/final_review_crosscut_r2` 原 Reviewer | 定向复核中 | 仅复核同一 env finding 的 remote/bridge/agent-proxy/session-ingress 旁路是否关闭，以及应用受控值、标准 proxy、普通变量边界 |
| 31 | 2026-07-31T20:00:00+08:00 | 第 2 轮 Review 二次修复复核结论 | `/root/final_review_crosscut_r2` 原 Reviewer | CLOSED | 对照 native 2.1.185 实际激活条件，remote/bridge/agent-proxy/session-ingress 链所需开关、端点、会话和凭据均已阻断；应用值与 proxy 边界无回归 |
| 32 | 2026-07-31T20:00:00+08:00 | 最终代码 Review 第 3 轮 | 三位新 clean-context Reviewer | 并行审查中 | full mode 最终轮；基于包含第 1/2 轮全部修复的完整 `origin/v1...HEAD` 独立重审 |
| 33 | 2026-07-31T20:16:38+08:00 | 最终代码 Review 第 3 轮结论 | 三位 Reviewer | MUST_FIX_FOUND | 去重 2 项：辅助/子代理模型选择 env 未受控；`CLAUDE_CODE_SHELL`/`CLAUDE_CODE_SHELL_PREFIX` 可覆盖应用 shell/进程启动策略；renderer reviewer PASS，无 decision-impact |
| 34 | 2026-07-31T20:16:38+08:00 | 末轮未收敛处置 | 主执行者 | 回到计划修订 | finding 证明现有 invariant/风险模型只覆盖认证、端点和已知 shell 键，未完整覆盖 native 模型选择与 shell wrapper 输入；按 full mode 硬门禁不加第 4 轮，修订计划并重跑 Plan Conformance 后以新版本重新计轮 |
| 35 | 2026-07-31T20:23:48+08:00 | 计划版本 2 修订提交 | 主执行者 | 已提交 | `docs: revise PowerShell runtime boundary plan`；扩充 invariant 4，新增 D10 和阶段 3；冻结 7 个 active 模型选择键与 2 个跨平台 shell 输入；production/test 两个 Fixer 可并行独占文件 |
| 36 | 2026-07-31T20:23:48+08:00 | 阶段 3 分派 | `/root/stage3_runtime_policy`、`/root/stage3_runtime_tests` Fixer | 并行启动 | P3.1 独占 `runtimeEnv.ts`；P3.2 独占 `runtimeEnv.test.ts`；共同以 D10 精确集合为契约，不修改对方文件 |
| 37 | 2026-07-31T20:30:21+08:00 | 阶段 3 验证 | `/root/stage3_validation` Validation Reviewer | PASS | D2/D5/D8/D10、invariant 2–4、非目标、两个 Fixer 并行 ownership 与全部验收项满足；目标 164 passed/72 skipped，全量 260 files/4679 tests passed，72 skipped |
| 38 | 2026-07-31T20:30:48+08:00 | 阶段 3 提交 | 主执行者 | 已提交 | `fix(agents): manage native model and shell inputs`；签署提交；计划阶段 3 标记 `✅`；工作树干净 |
| 39 | 2026-07-31T20:35:34+08:00 | 计划版本 2 符合性 | `/root/plan_conformance_v2` Plan Conformance Reviewer | PASS | D1–D10、四阶段、v1 review 全部修复、v2 阶段 3 分派/验证、非目标与签署提交一致；无 Blocking Gaps，可基于已提交 HEAD 重启 full review |
| 40 | 2026-07-31T20:35:34+08:00 | 计划版本 2 最终代码 Review 第 1 轮 | 三位新 clean-context Reviewer | 并行审查中 | full mode；runtime/packaging、renderer/permissions、cross-cutting 三视角重审包含 D10/阶段 3 的完整 `origin/v1...HEAD` |
| 41 | 2026-07-31T20:48:17+08:00 | 计划版本 2 最终代码 Review 第 1 轮结论 | 三位 Reviewer | MUST_FIX_FOUND | 去重 1 项：`CLAUDE_CODE_EXTRA_BODY` 可在 native 请求规范字段后展开 JSON 并覆盖 `model` 等托管字段；renderer/cross-cut reviewers PASS，无 decision-impact |
| 42 | 2026-07-31T20:48:17+08:00 | v2 第 1 轮 Review 修复分派 | `/root/stage3_runtime_policy`、`/root/stage3_runtime_tests` Fixer | 并行修复中 | 原 production/test owner 分别把精确键加入 inherited scrub/Agent block 与大小写参数化测试；不使用通配、不改变普通 JSON env |
| 43 | 2026-07-31T20:51:48+08:00 | v2 第 1 轮 Review 修复提交 | 主执行者 | 已提交 | `fix(agents): block native request body overrides`；目标 154 tests、`pnpm format`、`pnpm build:check`、`git diff --check` 通过；全量 260 files/4685 tests passed，72 skipped |
| 44 | 2026-07-31T20:51:53+08:00 | v2 第 1 轮 Review 修复复核 | `/root/v2_review_runtime_r1` 原 Reviewer | 定向复核中 | 仅复核 `CLAUDE_CODE_EXTRA_BODY` inherited/Agent 两路径、大小写匹配、普通 JSON env 与直接 SDK 调用点 |
| 45 | 2026-07-31T20:52:51+08:00 | v2 第 1 轮 Review 修复复核结论 | `/root/v2_review_runtime_r1` 原 Reviewer | CLOSED | inherited 与 Agent 两路径及大小写变体均关闭；普通 JSON env、应用模型、proxy、输入对象和 SDK 调用顺序无回归 |
| 46 | 2026-07-31T20:52:51+08:00 | 计划版本 2 最终代码 Review 第 2 轮 | 三位新 clean-context Reviewer | 并行审查中 | full mode；基于包含第 1 轮 request-body 修复的完整 `origin/v1...HEAD` 再次独立重审 |
| 47 | 2026-07-31T21:02:51+08:00 | 计划版本 2 最终代码 Review 第 2 轮结论 | 三位 Reviewer | MUST_FIX_FOUND | 去重 2 项：first-party base URL 假设键可重分类第三方 endpoint；流式 `tool-input-start` 缺 `providerExecuted` 使未知 `builtin_*` provider fallback 仍不可达；packaging reviewer PASS，无 decision-impact |
| 48 | 2026-07-31T21:02:51+08:00 | v2 第 2 轮 Review 修复分派 | 四位原 ownership Fixer | 并行修复中 | stage3 production/test owners 修精确 backend 键；stage2 backend/renderer owners 修 providerExecuted transform 与真实流式跨层回归测试 |
| 49 | 2026-07-31T21:07:39+08:00 | v2 第 2 轮 Review 修复提交 | 主执行者 | 已提交 | `fix(agents): preserve backend and tool identity`；目标 main 170、renderer 27 tests 通过，`pnpm format`、`pnpm build:check`、`git diff --check` 通过；全量 260 files/4693 tests passed，72 skipped |
| 50 | 2026-07-31T21:07:47+08:00 | v2 第 2 轮 Review 修复复核 | `/root/v2_review_runtime_r2`、`/root/v2_review_crosscut_r2` 原 Reviewer | 定向复核中 | runtime reviewer 复核 first-party base URL 键；cross-cut reviewer 复核 transform→chunk handler→generic renderer 真实流式链 |
| 51 | 2026-07-31T21:09:31+08:00 | v2 第 2 轮 Review 修复复核结论 | 两位原 Reviewer | CLOSED | first-party base URL 假设键在继承与 Agent 注入路径均被精确阻断；真实流式链保留 `providerExecuted` 并进入未知 provider tool 通用 fallback，两项均无直接回归 |
| 52 | 2026-07-31T21:09:31+08:00 | 计划版本 2 最终代码 Review 第 3 轮 | 三位新 clean-context Reviewer | 并行审查中 | full mode 最终轮；运行时安全、打包依赖、跨层行为三个独立视角审查完整 `origin/v1...HEAD` |
| 53 | 2026-07-31T21:23:37+08:00 | 计划版本 2 最终代码 Review 第 3 轮结论 | `/root/v2_review_runtime_r3`、`/root/v2_review_packaging_r3`、`/root/v2_review_crosscut_r3` | PASS | 三位 Reviewer 全部 `PASS_READY`，无 `MUST_FIX`：运行时视角确认托管环境边界、shell fallback 与 native 启动闭合；打包视角确认平台资源选择、ripgrep 解耦与产物规则闭合；跨层视角确认权限、流式 provider identity 与 renderer fallback 闭合；v2 clean final round 通过 |
| 54 | 2026-07-31T21:23:37+08:00 | 非阻塞收尾 | `/root/closeout_writer` Writer | 报告补齐；可选代码/注释跳过 | 只补齐同一份 closeout 报告并复制到最终可追踪路径；仅剩已明确接受的非阻塞 edge，最终干净轮后不扩大产品代码范围 |

### 阶段验证记录

| 阶段 | 提交时间戳 | 子任务分派 | 主执行者直接改动 | Validation Reviewer 结果 | 修复 / 提交时间 | 验证证据 |
|---|---|---|---|---|---|---|
| 阶段 0 | 2026-07-31T18:35:19+08:00 | P0.1 → `/root/stage0_packaging` Writer；P0.2 → `/root/stage0_binaries` Writer；P0.3 → `/root/stage0_runtime` Writer；同一时间窗并行启动 | 无 | PASS（`/root/stage0_validation`） | 无需修复；签署提交 `feat(agents): adopt native Claude runtime` | frozen install、10 个目标 main tests、8 个 filesystem tests、55 个 script tests、`pnpm format`、`pnpm build:check`、`pnpm build:unpack`、`git diff --check` 均通过；解包产物仅含 macOS ARM64 Claude/ripgrep 且可执行；两者在 node_modules 中实际执行通过 |
| 阶段 1 | 2026-07-31T18:49:16+08:00 | P1.1 → `/root/stage1_shell_env` Writer/Fixer；P1.2 → `/root/stage1_runtime_wiring` Writer；P1.3 → `/root/stage1_agent_modal` Writer；同一时间窗并行启动 | 无 | PASS（`/root/stage1_validation`） | process test mock 类型 TS2339 由 P1.1 owner 窄修复；签署提交 `feat(agents): fall back to PowerShell on Windows` | 目标 main 98 passed/72 skipped；AgentModal 3 passed；`pnpm format`、最终 `pnpm build:check`、`git diff --check` 通过；全量 256 files/4579 tests passed，72 skipped |
| 阶段 2 | 2026-07-31T19:04:04+08:00 | P2.1 → `/root/stage2_backend_tools` Writer；P2.2 → `/root/stage2_message_rendering` Writer/Fixer；P2.3 → `/root/stage2_tool_settings` Writer；同一时间窗并行启动 | 无 | PASS（`/root/stage2_validation`） | P2.2 初稿扩大 provider 前缀路由，原 owner 恢复 enterprise/v1 特殊路由后复测通过；签署提交 `feat(agents): render PowerShell tools` | 目标 main 35 passed；renderer 27 passed；`pnpm format`、`pnpm lint`、`pnpm test`（259 files/4609 passed/72 skipped）、`pnpm build`、`pnpm build:check`、`git diff --check` 均通过 |
| 阶段 3 | 2026-07-31T20:30:48+08:00 | P3.1 → `/root/stage3_runtime_policy` Fixer（`runtimeEnv.ts`）；P3.2 → `/root/stage3_runtime_tests` Fixer（`runtimeEnv.test.ts`）；同一时间窗并行启动 | 无 | PASS（`/root/stage3_validation`） | 无需阶段修复；签署提交 `fix(agents): manage native model and shell inputs` | 目标 3 files/164 passed/72 skipped；`pnpm format`、`pnpm build:check`（260 files/4679 passed/72 skipped）、`git diff --check` 通过；D10 精确集合、跨平台 shell、proxy/输入不变与无通配均由 Reviewer 验证 |

### 计划版本 v1 最终代码 Review 轮次记录

**Review mode**：full
**模式原因**：默认模式；用户未要求节省 token、cost 或 reviewer 数量。

| 轮次 | 时间戳 | Reviewers | MUST_FIX 去重结果 | 处理 / 复核 | 结论 |
|---|---|---|---|---|---|
| 1 | 2026-07-31T19:13:28+08:00 | `/root/final_review_runtime_r1`、`/root/final_review_renderer_r1`、`/root/final_review_crosscut_r1` | `BUN_OPTIONS` 未清理；设置写回丢失 opaque `PowerShell` ID | 分别交 `/root/stage1_shell_env` 与 `/root/stage2_tool_settings`；修复提交后两位原 Reviewer 定向复核均为 CLOSED | MUST_FIX_FOUND → FIXED_AND_CLOSED；renderer reviewer PASS |
| 2 | 2026-07-31T19:29:23+08:00 | `/root/final_review_runtime_r2`、`/root/final_review_renderer_r2`、`/root/final_review_crosscut_r2` | Claude 认证/后端选择 env 边界；`builtin_*` 未知 provider fallback（两 reviewer 同项已去重） | renderer finding 首次修复后 CLOSED；env finding 经首次直接选择器修复与二次 remote/bridge 扩充后 CLOSED | MUST_FIX_FOUND → FIXED_AND_CLOSED；runtime reviewer PASS；无 decision-impact |
| 3 | 2026-07-31T20:00:00+08:00 | `/root/final_review_runtime_r3`、`/root/final_review_renderer_r3`、`/root/final_review_crosscut_r3` | 辅助/子代理模型选择 env；shell executable/prefix 覆盖（runtime/cross-cut 同项已去重） | full 最终轮仍有 MUST_FIX；不得继续开轮，选择修订 D#/invariant/阶段与验收并重跑 Plan Conformance | MUST_FIX_FOUND → 回到计划版本 2；renderer reviewer PASS；无 decision-impact |

### 计划版本 v2 最终代码 Review 轮次记录

**Review mode**：full
**模式原因**：计划修订并经 Plan Conformance PASS 后，以新计划版本从第 1 轮重新开始；用户未要求 economy mode。

| 轮次 | 时间戳 | Reviewers | MUST_FIX 去重结果 | 处理 / 复核 | 结论 |
|---|---|---|---|---|---|
| 1 | 2026-07-31T20:35:34+08:00 | `/root/v2_review_runtime_r1`、`/root/v2_review_renderer_r1`、`/root/v2_review_crosscut_r1` | `CLAUDE_CODE_EXTRA_BODY` 请求体覆盖旁路 | 原 production/test owner 并行修复；全量门禁后原 runtime reviewer CLOSED | MUST_FIX_FOUND → FIXED_AND_CLOSED；renderer/cross-cut PASS；无 decision-impact |
| 2 | 2026-07-31T20:52:51+08:00 | `/root/v2_review_runtime_r2`、`/root/v2_review_packaging_r2`、`/root/v2_review_crosscut_r2` | `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` 重分类第三方 endpoint；流式 provider 类型在 start chunk 丢失 | 四位原 owners 并行修复；修复提交通过全量门禁，两个原 finding reviewers 定向复核均为 CLOSED | MUST_FIX_FOUND → FIXED_AND_CLOSED；packaging PASS；无 decision-impact |
| 3 | 2026-07-31T21:23:37+08:00 | `/root/v2_review_runtime_r3`、`/root/v2_review_packaging_r3`、`/root/v2_review_crosscut_r3` | 无 | 三个视角均为 `PASS_READY`，无 `MUST_FIX`；不再修改产品代码 | PASS；计划版本 v2 clean final round |

## 执行前总览

| 名称 | 类型 | 位置 | 执行前职责 / 行为 | 执行前问题 |
|---|---|---|---|---|
| `ClaudeCodeService` | service | `src/main/services/agents/services/claudecode/index.ts` | 通过 Node `fork()` 启动 SDK `cli.js`，Windows 仅注入 Git Bash 路径 | 无 Git Bash 时不能使用系统 PowerShell；旧 CLI 启动链不支持目标 fallback |
| `autoDiscoverGitBash()` | helper | `src/main/utils/process.ts` | 发现、校验并持久化 Git Bash | 无效持久化路径与来源可能继续污染 UI 状态 |
| `builtinTools` | tool metadata | `src/main/services/agents/services/claudecode/tools.ts` | 提供 Bash 等 Claude builtin tool metadata | 没有 PowerShell 权限元数据或平台暴露边界 |
| AgentModal Git Bash 配置 | UI workflow | `src/renderer/src/components/Popups/agent/AgentModal.tsx` | Windows 未找到 Git Bash 时阻止保存 Agent | PowerShell-only Windows 用户无法创建或编辑 Agent |
| Claude/ripgrep 打包 | config/workflow | `package.json`、`scripts/before-pack.js`、`electron-builder.yml` | SDK `0.2.112` 的 JS CLI 与内部 ripgrep 路径 | SDK 升级后原生 binary 与 ripgrep 资源缺少稳定所有权和产物验证 |

## 最终形态总览

| 名称 | 类型 | 最终位置 | 最终职责 / 行为 | 来源 |
|---|---|---|---|---|
| Native SDK/binary 解析与打包 | helper/config | `src/main/utils/bundledBinaries.ts`、`scripts/before-pack.js`、`electron-builder.yml` | 选择并打包目标平台 Claude native binary 与独立 ripgrep | D3、D4、阶段 0 |
| Windows shell/env policy | helper | `src/main/services/agents/services/claudecode/runtimeEnv.ts`、`src/main/utils/process.ts` | Git Bash 优先，缺失时 PowerShell；确定性合并用户 proxy env | D2、D5、D7、阶段 1 |
| Managed native runtime env boundary | helper / runtime policy | `src/main/services/agents/services/claudecode/runtimeEnv.ts`、`src/main/services/agents/services/claudecode/index.ts` | 托管认证、endpoint、remote/session、7 个模型选择键、request body 与 first-party 假设键；`CLAUDE_CODE_SHELL`/`CLAUDE_CODE_SHELL_PREFIX` 及全部托管键按大小写不敏感语义阻断继承和 Agent 注入，标准 proxy 与普通 env 继续保留 | D5、D10、阶段 3、v1/v2 Review 修复 |
| PowerShell 工具目录与渲染 | metadata/UI | `src/main/services/agents/services/claudecode/tools.ts`、`src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/`、`ToolsSettings.tsx` | Windows 暴露和授权 PowerShell，非 Windows 运行时过滤，消息终端卡片正确呈现 | D6、D9、阶段 2 |

## 关键差异明细

### Native Claude runtime 与 ripgrep

**类型**：helper / config / workflow
**执行前位置**：多个旧 SDK 内部路径
**最终位置**：`src/main/utils/bundledBinaries.ts`、`scripts/before-pack.js`、`electron-builder.yml`、`package.json`

**执行前形态**：SDK JS CLI + SDK 私有 ripgrep 路径。
**最终形态**：Claude Agent SDK 通过平台原生 binary 启动；FileStorage 与 filesystem MCP 通过独立 `@cherrystudio/ripgrep` resolver 执行目标平台 `rg`；构建脚本按目标平台/架构裁剪并解包资源。

**验证证据**：冻结安装、目标/全量 tests、format/build check/unpack 均通过；macOS ARM64 解包产物仅含目标 Claude/ripgrep，权限均为可执行；node_modules 中 Claude 2.1.185 与 ripgrep 14.1.1 实际执行通过。

### Windows shell policy

**类型**：helper / runtime workflow
**执行前位置**：`ClaudeCodeService` 内联 Git Bash 逻辑
**最终位置**：`src/main/services/agents/services/claudecode/runtimeEnv.ts`、`src/main/services/agents/services/claudecode/index.ts`、`src/main/utils/process.ts`

**执行前形态**：Git Bash 为唯一 Windows Agent shell。
**最终形态**：有效 Git Bash 保持首选；缺失时启用系统 PowerShell、关闭其 telemetry 并禁用 Bash 工具；用户标准 proxy 环境可确定性覆盖，受保护键不可覆盖；失效 Git Bash 路径与来源同步清理。

**验证证据**：80 个 runtime env 参数化测试、process/proxy 目标测试、全量 typecheck/lint/test、Validation Reviewer 均通过。

### Managed native runtime env boundary

**类型**：helper / runtime policy
**执行前位置**：`ClaudeCodeService` 的通用环境继承与 Agent 自定义环境合并路径
**最终位置**：`src/main/services/agents/services/claudecode/runtimeEnv.ts`、`src/main/services/agents/services/claudecode/index.ts`

**执行前形态**：标准 proxy 与普通用户环境可合并，但 native Claude 的认证、后端、remote/session、模型选择、request body、first-party 假设和 shell wrapper 输入缺少完整、大小写不敏感的托管边界。
**最终形态**：应用统一托管认证与 endpoint、remote/bridge/agent-proxy/session-ingress、7 个模型选择键、`CLAUDE_CODE_EXTRA_BODY`、first-party base URL 假设键，以及 `CLAUDE_CODE_SHELL`/`CLAUDE_CODE_SHELL_PREFIX`；这些键的继承值和 Agent 注入值均按大小写不敏感语义阻断。标准 HTTP(S)/ALL/NO/SOCKS proxy、`grpc_proxy` 和普通环境变量仍按既有规则保留。

**验证证据**：阶段 3 Validation Reviewer PASS；计划版本 v2 三轮 full Review 最终 PASS；最终目标 main 170 个与 renderer 27 个测试通过，`pnpm build:check` 全量为 260 files/4693 passed/72 skipped。

### PowerShell tool 与 Agent UX

**类型**：tool metadata / renderer / UI workflow
**执行前位置**：不存在 PowerShell tool；AgentModal 强制 Git Bash
**最终位置**：`src/main/services/agents/services/claudecode/tools.ts`、`src/main/services/agents/BaseService.ts`、`src/renderer/src/pages/home/Messages/Tools/`、`src/renderer/src/pages/settings/AgentSettings/components/ToolsSettings.tsx`

**执行前形态**：无 PowerShell tool 卡片，Git Bash 缺失时保存被阻止。
**最终形态**：Windows 工具目录暴露权限受控 PowerShell；非 Windows 两个 runtime allowed 副本都过滤该 ID 但持久化 opaque 值不丢失；PowerShell call/result 使用翻译后的终端卡片，未来未知 provider tool 使用通用 fallback。

**验证证据**：工具 metadata/catalog/runtime/transform 35 个目标测试，消息/设置 27 个目标测试，以及全仓 format/lint/test/build/build:check 均通过。

## 删除 / 合并 / 迁移矩阵

| 旧结构 / 旧路径 | 最终归宿 | 是否保留 facade / 兼容层 | 删除或迁移条件 |
|---|---|---|---|
| SDK `cli.js` + Node `fork()` 启动 | `pathToClaudeCodeExecutable` + native SDK binary | 否；resolver 失败转换为订阅安全的 stream error | 阶段 0 已迁移完成并通过 Validation Reviewer 门禁 |
| SDK 内部 ripgrep vendor 路径 | `@cherrystudio/ripgrep` + `resolveBundledRipgrepPath()` | 统一 resolver | 阶段 0 已迁移完成并通过打包、解包与执行验证 |
| AgentModal Git Bash required 门禁 | optional Git Bash tooltip + PowerShell fallback | 不适用 | 阶段 1 已删除保存门禁与 required 状态；无 Git Bash 时仍可提交 Agent |
| `agent.gitBash.error.*` / `notFound` required 文案 | 删除 | 否 | 计划版本 v1 Plan Conformance 修复已删除 12 个 locale 中的废弃 required 文案，保留 optional tooltip 与 PowerShell 文案 |

## 验证与 Review

| 项目 | 结果 | 证据 |
|---|---|---|
| 阶段 agent 分派 | 完整 | 四阶段均至少并行分派 2 个独立 Writer/Fixer：阶段 0 三项、阶段 1 三项、阶段 2 三项、阶段 3 两项；ownership 与并行启动证据见阶段验证记录，主执行者未直接完成阶段产品代码 |
| 阶段验证 | PASS | 阶段 0–3 均由独立 clean-context Validation Reviewer 判定 PASS；修复均交回原 owner，阶段提交与命令证据见阶段验证记录 |
| 计划符合性 | PASS | 计划版本 v1 首次 FAIL，删除废弃 required 文案后复审 PASS；v1 第 3 轮未收敛后修订计划版本 v2，阶段 3 完成后 `/root/plan_conformance_v2` 对 D1–D10、四阶段、分派、验证和非目标判定 PASS |
| 最终代码 Review | PASS | full mode：计划版本 v1 完成 3 轮后按硬门禁修订为 v2；计划版本 v2 完成 3 轮，第 1/2 轮 findings 修复并由原 Reviewer 复核 CLOSED，第 3 轮三位 Reviewer 全部 `PASS_READY`、无 `MUST_FIX`，v2 clean final round 通过 |
| 非阻塞收尾 | 已跳过可选代码/注释 | `/root/closeout_writer` 只补齐 closeout 报告；仅剩明确非阻塞 edge，最终干净轮后不扩大产品代码范围 |
| 命令验证 | 已运行 | 最终 `pnpm format`、`pnpm build:check`（260 files/4693 passed/72 skipped）、目标 main 170、renderer 27 与 `git diff --check` 通过；更早阶段已通过全量 `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm build:unpack`，并检查 macOS ARM64 解包产物仅含目标 Claude/ripgrep、权限可执行且二进制可实际运行 |

## 未做 / 风险 / 待决

1. 真实 Windows PowerShell E2E，以及 Windows/Linux 打包实产物 E2E 未执行 — 这是当前宿主与计划非目标决定的已接受实机风险；平台参数化测试、打包规则测试和 macOS ARM64 packaged artifact 实检覆盖了可自动验证面，不影响本次 PASS。
2. `builtin_PowerShell` 异常别名未做规范化 — 当前 SDK 使用精确 `PowerShell`，该输入不在正常调用路径；保留为非阻塞 edge，不扩大别名兼容范围。
3. Linux 缺少 `process.report` 时，libc 选择使用 fallback — 极端实际环境可能与 fallback 假设不一致；正常 glibc/musl 解析已有测试覆盖，本项为非阻塞 edge。
4. packaged resolver 的自动测试主要在开发态模块布局运行 — macOS ARM64 `pnpm build:unpack` 实产物已验证 Claude/ripgrep 的存在、架构与可执行性，因此这是测试观察面的限制，不是交付失败。
5. PR 未创建 — 符合计划的明确非目标；等待用户另行要求。

## 交付状态

- 实现：完成；四阶段 Validation 均为 PASS
- Plan Conformance：完成；计划版本 v1 修复后 PASS，计划版本 v2 最终 PASS
- 最终代码 Review：完成；计划版本 v2 第 3 轮无 `MUST_FIX`，三位 Reviewer 全部 `PASS_READY`
- 计划文件：本报告提交后将与最终审计报告在独立清理提交中删除
- 执行中报告：`.context/reports/port-enterprise-powershell-support-v1-closeout.md`；按执行协议保留
- 最终审计报告：`docs/reports/port-enterprise-powershell-support-v1-closeout.md`；本报告提交后将与计划文件在独立清理提交中删除
- PR：未创建；等待用户明确要求
