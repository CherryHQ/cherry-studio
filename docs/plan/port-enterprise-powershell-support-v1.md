# v1 社区版移植企业版 PowerShell 支持计划

**负责人**: Codex
**日期**: 2026-07-31
**计划版本**: v2（2026-07-31T20:16:38+08:00 因 v1 full review 第 3 轮未收敛而修订）

---

## 执行协议

> 本区块随计划文件常驻，供执行 agent 在技能指令滑出上下文后恢复规则。
>
> 1. 本计划经用户明确批准后闭环执行，阶段之间不停；只有命中暂停条件才停。批准同时授权本计划要求的 subagent delegation / parallel agent work。
> 2. 写代码前先提交本计划。执行报告草稿写入 `.context/reports/port-enterprise-powershell-support-v1-closeout.md`，不得提交；所有审计事件使用带时区的 ISO 8601 时间戳，不记录 Git hash。
> 3. 阶段是依赖拓扑层。每个阶段至少并行分派 2 个独立 Writer/Fixer/Explorer；主执行者只负责边界、集成、冲突、validation ledger、review 和提交。
> 4. Codex 子 agent 一律使用 `delegation.spawn_agent`、`fork_turns: "none"`；Writer/Fixer/Explorer 使用 `reasoning_effort: "medium"`，Reviewer 继承主线程 effort。所有 reviewer 只读且使用 clean context。
> 5. 每阶段结束必须由 clean-context Validation Reviewer 对照本阶段 D#、非目标、invariant、diff、验收结果和至少 2 个实现 agent 的分派证据审查；PASS 后才提交，一阶段一提交。
> 6. 所有阶段完成后先做 Plan Conformance Review；PASS 且相关修复已提交后，才能进入最终代码 review。
> 7. 最终代码 review 使用 full mode：每轮 3 个全新 clean-context Reviewer，最多 3 轮。普通 `MUST_FIX` 由 Writer 修复并交原 Reviewer 复核；decision-impact finding 回到计划修订和 Plan Conformance。
> 8. 若 full mode 第 3 轮仍有 `MUST_FIX`，不得继续加轮次；必须修订计划后重跑符合性，或暂停报告未收敛原因。
> 9. required subagent/reviewer 无法启动时立即阻断，不得降级为主执行者自写、自修或自审。
> 10. 非阻塞收尾只允许极小文档、注释和说明改动，且文件改动仍须分派 Writer。
> 11. 最终审计报告先从 `.context` 草稿移动到 `docs/reports/port-enterprise-powershell-support-v1-closeout.md` 并提交，随后在独立清理提交中同时删除本计划和最终报告。
> 12. 比较和 review 基线统一使用 `origin/v1`，不得套用技能模板中的 `origin/main`。不自动创建 PR。

---

## 背景

当前 `origin/v1` 的 Windows Agent 运行链仍以 Git Bash 为硬前提：`AgentModal` 在未检测到 `bash.exe` 时阻止保存，`ClaudeCodeService` 只向旧版 Claude Agent SDK 注入 `CLAUDE_CODE_GIT_BASH_PATH`，并通过 Node `fork()` 执行 SDK 的 `cli.js`。这意味着只具备 Windows 自带 PowerShell 的环境无法运行 Agent。

企业版已经在提交 `d3c3302b4c`（`feat(agents): support PowerShell fallback and native SDK binaries (#91)`）中打通完整链路：升级 Claude Agent SDK，使用平台原生 Claude 可执行文件；Git Bash 可用时继续优先使用，否则启用 SDK 的 PowerShell 工具；同时补齐打包、ripgrep、代理透传、工具注册、消息渲染和测试。企业版该提交之后未发现 PowerShell 相关 follow-up。

本计划不直接 cherry-pick 企业版 squash commit。企业版提交基于不同的私有分支且混有依赖兼容调整，当前社区版 `origin/v1` 已继续演进；实施时按行为和测试逐项移植，并以当前 v1 代码为真相解决冲突。

**关联**：

- 目标基线：`origin/v1`，计划编写时为 `06958c8f88`
- 移植源：企业版 `origin/main` 中的 `d3c3302b4c`
- `src/main/services/agents/services/claudecode/index.ts` — Agent SDK 启动、环境变量、代理和工具可用性
- `src/main/utils/process.ts` — Git Bash 配置、发现与校验
- `src/renderer/src/components/Popups/agent/AgentModal.tsx` — Windows Git Bash 配置及当前保存门禁
- `scripts/before-pack.js`、`electron-builder.yml` — 多平台原生依赖筛选与 asar unpack
- `src/main/services/FileStorage.ts`、`src/main/mcpServers/filesystem/types.ts` — 当前依赖旧 SDK 内置 ripgrep 的消费者

---

## 现状 → 目标

**一句话摘要**：Windows Agent 必须安装 Git Bash → Git Bash 可选且优先，缺失时自动使用系统 PowerShell。

| 维度 | 现状 | 痛点 | 目标 |
|---|---|---|---|
| Windows Shell 选择 | 仅配置 `CLAUDE_CODE_GIT_BASH_PATH` | 无 Git Bash 时 Agent 不可用 | 有有效 Git Bash 时使用 Git Bash，否则启用 PowerShell 工具 |
| Agent 创建/编辑 | 未找到 Git Bash 时禁止提交 | PowerShell-only Windows 无法创建 Agent | Git Bash 路径保留为可选配置，不再阻止提交 |
| SDK 启动 | SDK `0.2.112` + Node `fork(cli.js)` | 旧启动链不提供目标 PowerShell fallback | SDK `0.3.185` + 平台原生 Claude 二进制 |
| 原生资源打包 | 只处理 sharp/libsql/ocr 等平台包，ripgrep 来自旧 SDK | SDK 升级后路径和资源模型失效 | 显式携带平台 Claude binary 与独立 ripgrep，按目标平台裁剪 |
| 代理 | Node 子进程注入 proxy bootstrap | 原生二进制不能使用 Node `--require` 注入 | 通过标准代理环境变量透传给原生子进程 |
| 工具模型 | 仅注册和渲染 Bash | PowerShell 调用会缺少描述或落入空白渲染 | 注册 `PowerShell` 权限工具，正确转换、路由、显示命令与输出 |
| 失效配置 | 无效 Git Bash 路径可能继续显示 | UI 和运行时对实际状态认知不一致 | 校验失败后同时清空路径及来源，再进入 PowerShell fallback |

### 核心 invariant

1. 非 Windows 平台的 shell 环境、对外暴露的 builtin tool catalog、内部 `autoAllowTools`、传给 SDK 的 `options.allowedTools` 和 AgentModal 行为不变；`PowerShell` 可作为内部权限元数据或 opaque 持久化 ID 存在，但不得出现在 macOS/Linux 的 Agent/Session 工具列表或任一运行时授权集合。
2. Windows 上有效 Git Bash 的优先级高于 PowerShell fallback。
3. PowerShell fallback 时不得向 SDK 暴露不可执行的 `Bash` / `builtin_Bash`。
4. 登录环境和用户自定义环境变量不得覆盖 shell/进程启动选择、认证/后端、remote/bridge/agent-proxy/session-ingress、Cherry 管理的主模型/默认模型/辅助模型/子代理模型和内部代理引导键；这些 native runtime 输入必须按 D10 的显式集合清理或拒绝。现有标准 proxy 白名单中的 HTTP(S)/ALL/NO/SOCKS 大小写变体及 `grpc_proxy` 明确允许按 Agent 覆盖应用进程值。所有受管键按大小写不敏感语义匹配；Windows 上合并普通环境键时同样按大小写不敏感语义去重，确保允许的用户值确定性胜出。
5. 打包结果只保留目标平台/架构所需的 Claude native package 和 ripgrep 资源；Windows ARM64 使用原生 ARM64 Claude/ripgrep，不额外保留 x64 fallback。
6. 所有用户可见字符串进入 i18n；不得新增 `console.log` 到应用运行时代码。

### 非目标

1. 不引入 Shell 选择器或新增 Redux/数据库状态；shell 选择保持自动策略。
2. 不把 PowerShell 7、Git Bash、uv、bun 或其他运行时打入社区版；PowerShell fallback 使用 Windows 系统自带 PowerShell 5.1+。
3. 不移植企业登录、Passport、企业服务器、品牌、版本号、发布和 CI 改动。
4. 不修改 v2 分支或被声明为 v2 数据/UI 重构阻塞的数据结构。
5. 不改变 Agent 权限模式语义；PowerShell 与 Bash 一样继续经过工具授权。
6. 本机为 macOS，不把真实 Windows 机器 E2E 作为本计划的阻塞验收；用平台选择单测、运行时环境单测、打包配置 inspection 和当前宿主原生二进制执行测试覆盖可自动验证部分。
7. 不自动创建 PR。

---

## 决策

### D1 — 以企业版最终行为为移植规范，不直接 cherry-pick

**选定方案**：逐文件重放企业版 `d3c3302b4c` 的社区通用行为和测试，按当前 `origin/v1` 结构适配；只有与 PowerShell/native SDK 闭环直接相关的兼容修改进入范围。

**理由**：企业版 squash commit 一次修改 42 个文件，包含 SDK peer dependency 兼容、原生资源、现有 ripgrep 消费者和 UI 渲染，语义上是一个闭环；但其父提交位于企业私有分支，直接 cherry-pick 容易把私有差异和旧基线冲突一起带入。逐项移植可明确审计每个文件为何需要变更，并保留当前 v1 后续修复。

**备选方案**：

- **直接 cherry-pick 企业版提交**：操作快。拒绝原因：私有基线和当前 v1 已分叉，会产生大面积上下文冲突且难以证明没有夹带企业专属逻辑。
- **只复制环境变量开关**：改动小。拒绝原因：旧 SDK/`cli.js` 启动链没有企业版所依赖的原生 PowerShell 工具闭环，运行时、打包和渲染都会缺失。

### D2 — Git Bash 优先，缺失时自动回退系统 PowerShell

**选定方案**：新增纯函数集中管理 Windows shell 环境。Windows + 有效 Git Bash 时只设置 `CLAUDE_CODE_GIT_BASH_PATH`；Windows + 无 Git Bash 时设置 `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` 和 `POWERSHELL_TELEMETRY_OPTOUT=1`，并把 `Bash`、`builtin_Bash` 加入 `disallowedTools`。进入任一分支前按大小写不敏感规则删除旧的托管键。

**理由**：这与企业版最终实现一致，并保证既有 Git Bash 用户行为不回归。集中在独立纯函数中可在 macOS 上显式传入 `windows=true` 做平台无关单测，也避免 `ClaudeCodeService` 内散落大小写敏感清理逻辑。

**备选方案**：

- **PowerShell 永远优先**：可减少 Git Bash 依赖。拒绝原因：改变现有用户 shell 语义，且可能破坏依赖 POSIX 命令的工作流。
- **让用户手工选择 shell**：控制更显式。拒绝原因：需要新增持久化设置和 UI/迁移，超出本次最小移植范围。

### D3 — 升级 SDK 并使用平台原生 Claude binary

**选定方案**：将 `@anthropic-ai/claude-agent-sdk` 升到企业版验证过的 `0.3.185`，同步其要求的 `@anthropic-ai/sdk` `0.93.0` 和 `@modelcontextprotocol/sdk` `1.29.0`；把各平台/架构 Claude SDK binary package 列为 optional dependencies。新增 resolver 按 `process.platform`、`process.arch` 和 Linux libc 选择可执行文件，SDK 改用 `pathToClaudeCodeExecutable` 与 `stderr` 回调。若当前平台 binary 缺失，`ClaudeCodeService.invoke()` 捕获 resolver 错误并记录结构化日志；与现有 query error 路径一致，用 `setImmediate`（或可证明同等订阅安全的调度）在 `invoke()` resolve 后向 Agent stream 发出一次 `type: 'error'`。调用 Promise 不 reject、应用启动不失败，且调用方在 `await invoke()` 后注册 listener 必须能收到该事件。

**理由**：PowerShell 工具和 Windows 原生启动是企业版能力的基础。optional dependencies 让当前宿主只安装匹配包，同时构建脚本可为交叉构建补齐目标包。Linux 同时保留 glibc/musl 候选回退，避免 SDK 升级只修 Windows却破坏 Linux。

**备选方案**：

- **继续 fork `cli.js` 并 patch 旧 SDK**：减少依赖升级。拒绝原因：需要维护私有 SDK 补丁，仍缺少官方原生 binary 的 PowerShell 实现和未来兼容路径。
- **仅在 Windows 使用新 SDK，其他平台保持旧 SDK**：降低表面风险。拒绝原因：同一依赖无法在打包产物中维护两套不兼容 API/peer dependency。

### D4 — ripgrep 从 Claude SDK 解耦为显式依赖

**选定方案**：新增 `@cherrystudio/ripgrep@1.0.0`，统一 resolver 返回目标平台可执行文件；`FileStorage` 和 filesystem MCP 改用该 resolver，后者直接 spawn `rg/rg.exe`，不再加载旧 SDK 的 `ripgrep.node`。打包筛选严格采用目标平台/架构：Windows ARM64 只保留 `arm64-win32` ripgrep 和 `win32-arm64` Claude package；旧脚本为缺少 ARM64 资源而保留的 `x64-win32` 模拟 fallback 随本次显式 ARM64 依赖一并移除。

**理由**：升级后的 Claude SDK native package 不再保证旧 `vendor/ripgrep` 布局，而社区版有两个非 Agent 消费者依赖该私有路径。显式依赖让资源所有权清晰，也能单独验证 binary 版本与执行。

**备选方案**：

- **从新 SDK native package 内继续找 ripgrep**：少一个依赖。拒绝原因：继续耦合未承诺的内部目录，且不同平台包布局不稳定。
- **调用系统 `rg`**：包体更小。拒绝原因：多数终端用户未安装 ripgrep，会使文件搜索能力从“随应用可用”退化为外部依赖。

### D5 — 原生进程使用标准代理环境变量

**选定方案**：移除 Claude Agent 的 Node `fork()` 和 proxy bootstrap 注入，继续通过现有 `getProxyEnvironment()` 保留完整 whitelist：`HTTP_PROXY/http_proxy`、`HTTPS_PROXY/https_proxy`、`ALL_PROXY/all_proxy`、`NO_PROXY/no_proxy`、`SOCKS_PROXY/socks_proxy`、`grpc_proxy` 及 Cherry proxy 配置键。Cherry 内部 `CHERRY_STUDIO_NODE_PROXY_*` 继续禁止 Agent 配置覆盖；上述标准 proxy 键允许 Agent 自定义值覆盖进程值。新增纯函数负责最终用户环境合并：Windows 上先删除与用户键大小写不敏感同名的既有键再写入，其他平台保持现有大小写语义；测试锁定完整白名单、空值清理、阻断键及最终优先级。

**理由**：原生 binary 不能使用 Electron/Node 的 `execArgv --require` 注入。企业版已验证环境变量透传路径；显式单测可防止把无关用户环境泄漏给断言目标，且保留 SOCKS/NO_PROXY。

**备选方案**：

- **为原生 binary 再包一层 Node launcher**：可复用 bootstrap。拒绝原因：重新引入进程代理层和跨平台 quoting/IPC 风险，抵消 native binary 的目的。
- **不传代理**：实现最简单。拒绝原因：企业网络和已有代理配置会直接回归。

### D6 — Git Bash UI 降级为可选配置，PowerShell 作为一等工具渲染

**选定方案**：保留 Windows Git Bash 自动发现、手动选择和重置 UI，但移除 required 标记、提交校验与 disabled 状态；tooltip 和所有 locale 必须明确“Git Bash 可选，未配置时 Agent 使用 PowerShell”，不得继续出现 required 语义。新增 `PowerShell` builtin tool、类型映射、权限描述、图标、label 和复用终端卡片。`toolType === 'provider'` 的工具统一进入 Agent tool renderer，已知 PowerShell 使用专用 renderer，未知 provider tool 保持通用 fallback。AgentModal 必须有行为测试证明 Windows + `path: null` 时保存按钮可用且提交继续调用 add/update，同时保留有效 Git Bash 路径的展示与配置交互。

**理由**：运行时 fallback 生效后 UI 不能再把 Git Bash 当硬门禁。PowerShell 是 SDK provider tool，必须跨流转换、消息路由和工具设置完整呈现；通用 provider fallback 还能避免未来 SDK 新工具再次空白。

**备选方案**：

- **隐藏全部 Git Bash UI**：界面更简单。拒绝原因：Git Bash 仍是首选路径，便携版/非标准安装仍需要手工配置。
- **把 PowerShell 当 Bash 重命名显示**：改动少。拒绝原因：用户会看到错误 shell 名称，权限审计和命令语义也不准确。

### D7 — 无效 Git Bash 配置立即双键清理

**选定方案**：`autoDiscoverGitBash()` 或 `getGitBashPathInfo()` 发现持久化路径失效时，同时清空 `GitBashPath` 与 `GitBashPathSource`，随后尝试重新发现；失败则向 UI 返回 `{ path: null, source: null }` 并允许 PowerShell fallback。

**理由**：旧路径可能因升级、卸载或磁盘变化失效。若只返回 null 而不清理来源，UI 会持续显示与运行时不一致的状态，且每次启动重复校验。

**备选方案**：

- **仅内存忽略，保留配置**：用户重装后可能自动恢复。拒绝原因：配置长期陈旧并污染 UI 状态，且自动发现已有恢复能力。
- **无效路径仍阻止 Agent**：更保守。拒绝原因：与 PowerShell fallback 的核心目标冲突。

### D8 — 验证采用平台纯函数 + 当前宿主执行 + 全仓检查

**选定方案**：移植企业版针对 shell env、工具注册/转换、binary resolver、消息路由、AgentModal、工具设置和代理的单测；平台选择函数显式接收 platform/arch/windows 参数；当前 macOS 宿主实际执行安装的 Claude 和 ripgrep binary。打包筛选逻辑提取为可执行纯函数测试，覆盖 Windows ARM64/x64、macOS 和 Linux；运行 `pnpm build:unpack` 后 inspection 当前宿主 `app.asar.unpacked`，证明 Claude native binary 与 ripgrep 存在、可执行且非目标架构未进入产物。每阶段提交前先通过 `pnpm format` 和仓库要求的 `pnpm build:check`；完成前另行显式通过 `pnpm lint`、`pnpm test`、`pnpm format`、`pnpm build`。

**理由**：本工作区无法直接完成 Windows 真实进程 E2E，但可把平台判断与环境构造从系统状态中抽离，并实际验证当前宿主资源解析。全仓检查覆盖依赖升级引起的类型/API 漂移，`pnpm build` 覆盖 Electron bundle 入口。

**备选方案**：

- **只跑新增单测**：反馈快。拒绝原因：SDK peer dependency 和类型导出变化影响多个既有模块，局部测试无法证明无回归。
- **要求 Windows E2E 后才合入**：证据最强。拒绝原因：当前环境没有 Windows runner，会把可完成的移植永久阻断；真实 Windows 验证保留为 PR/CI 后续信号。

### D9 — PowerShell 权限元数据可全局存在，对外工具目录仅 Windows 暴露

**选定方案**：`builtinTools` 保留 `PowerShell` 元数据，供权限检查在收到 SDK 调用时统一使用；新增平台可参数化的 exposed-tools/runtime-allowed helper，`BaseService.listMcpTools()` 只在 Windows 把 `PowerShell` 放入 Agent/Session 工具目录。macOS/Linux 不显示 `PowerShell`，且从 `session.allowed_tools` 构造内部 `autoAllowTools` 和 SDK `options.allowedTools` 两个运行时副本时都过滤该 ID；数据库/API 中已有的 opaque `allowed_tools: ['PowerShell']` 保留用于跨平台往返，不做破坏性清理或回写。renderer 仍能容错展示历史或跨平台导入的 PowerShell 消息。

**理由**：企业版直接把 PowerShell 放入全局 `builtinTools`，会通过当前 `BaseService` 无条件暴露到所有平台，违反本计划的非 Windows invariant。当前 `ClaudeCodeService` 还有内部 `autoAllowTools` 和 SDK `options.allowedTools` 两条独立授权通道，必须同时处理。把“权限元数据”“平台可用目录”“运行时副本”“持久化往返”分开可保留统一授权逻辑和跨平台配置数据，同时不向非 Windows 用户宣传或自动授权不可执行工具。renderer 的容错能力不等于设置目录暴露；保留 opaque ID 也不等于运行时可用。

**备选方案**：

- **所有平台都暴露和自动授权 PowerShell**：最贴近企业版提交。拒绝原因：改变 macOS/Linux 工具设置和 runtime 观察面，且这些平台没有对应 shell。
- **非 Windows 删除持久化 `allowed_tools` ID**：平台边界最严格。拒绝原因：跨平台打开同一数据库会造成有损配置迁移；保留 opaque ID、过滤 catalog/runtime 更安全。

### D10 — Native runtime 的模型与 shell 输入由应用统一托管

**选定方案**：在 `runtimeEnv.ts` 中把 native Claude `2.1.185` 已确认 active 的模型选择键集中为显式 managed set：`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`、`ANTHROPIC_DEFAULT_FABLE_MODEL`。前四项由 `ClaudeCodeService` 写入规范大写值并清除大小写 alias；后三项不由社区版配置，必须从继承环境清理并拒绝 Agent `env_vars` 注入。另将跨平台 active 的 `CLAUDE_CODE_SHELL`、`CLAUDE_CODE_SHELL_PREFIX` 从继承环境清理并拒绝 Agent 注入，防止替换应用 shell 或包装 Bash、hook 和 stdio MCP 进程。

`CLAUDE_CONTEXT_COLLAPSE_MODEL`、`CLAUDE_CODE_AUTO_MODE_MODEL`、`CLAUDE_CODE_BG_CLASSIFIER_MODEL` 在当前 binary 中只有 schema/类型声明、没有确认消费者，不作为 active 键虚构行为，也不纳入本次最小集合；未来 SDK 升级时重新核对。不得用 `ANTHROPIC_*`、`CLAUDE_CODE_*` 等宽泛通配替代显式集合，以免删除标准 runtime 配置或未来合法能力。

**理由**：计划 v1 只冻结了主模型、认证、代理和 Git Bash/PowerShell 键，最终 review 第 3 轮证明 native CLI 还会优先读取辅助/子代理模型和 shell wrapper 输入。登录环境或 Agent 配置可由此绕过 Cherry 选定模型、产生错误路由/计费，或改变 shell、hook 与 MCP 启动命令。把确认 active 的输入收敛到可审计的显式集合，既闭合当前安全/行为边界，也保留标准 proxy 与普通环境变量兼容性。

**备选方案**：

- **阻断全部 `ANTHROPIC_*` / `CLAUDE_CODE_*`**：覆盖面最广。拒绝原因：会误删应用和 SDK 的合法配置，且无法说明每个键的所有权。
- **只阻断用户 `env_vars`，保留登录环境**：改动更小。拒绝原因：登录 shell 是同一可利用输入通道，native SDK 会原样接收最终 `Options.env`。
- **只在 Windows 阻断 shell override**：贴近 PowerShell 主题。拒绝原因：两个键在当前 native 实现中跨平台生效，`CLAUDE_CODE_SHELL_PREFIX` 即使在 PowerShell fallback 下仍可影响 stdio MCP 启动。

---

## 实施计划

### 阶段 0 — Native SDK 可编译/可打包基础 〔状态：✅ 已完成〕

**阶段依赖**：无。

**并行性说明**：依赖/打包、binary resolver/ripgrep 消费者、SDK 启动/API 兼容分别以 D3–D5 已冻结的包名和函数契约为输入，文件 ownership 不重叠；必须在同一阶段交付，避免只升级依赖却让阶段提交处于无法 typecheck 的中间态。

**分派建议**：并行启动 3 个 Writer。P0.1 独占 manifest、lockfile 和打包脚本；P0.2 独占 resolver、ripgrep 消费者及其单测；P0.3 独占 Claude native 启动、peer API 兼容和 proxy tests。主执行者只处理 lockfile/格式化和已冻结 import contract 的窄集成冲突。

**范围**：一次性建立可编译、可运行、可打包的新 SDK/native binary/ripgrep 基础；本阶段不启用 PowerShell fallback。

#### 子任务 P0.1 — 升级依赖并适配打包筛选

**目标**：完成 SDK/peer dependency/optional native packages 升级，确保 electron-builder 解包并按目标平台/架构保留正确资源。

**文件**：

- `package.json` — 修改
- `pnpm-lock.yaml` — 机械更新
- `electron-builder.yml` — 修改
- `scripts/before-pack.js` — 修改
- `scripts/__tests__/before-pack.test.ts` — 新增

**步骤**：

1. 按 D3/D4 更新依赖及 optional dependencies，并用 pnpm 生成一致 lockfile。
2. 把 Claude native packages 纳入现有平台包裁剪清单；把 ripgrep 过滤路径从旧 SDK 改为独立包。
3. 将目标包/资源过滤提取为可参数化纯函数，覆盖 Windows ARM64 只保留原生 ARM64、Windows x64、macOS 和 Linux。
4. 在 `asarUnpack` 中加入 SDK native packages 和 ripgrep vendor 目录，保留现有 sharp 等配置。

#### 子任务 P0.2 — 统一 native binary resolver 与 ripgrep 消费者

**目标**：提供 Claude/ripgrep 可执行文件解析 API，并切断业务模块对旧 SDK 内部 vendor 路径的依赖。

**文件**：

- `src/main/utils/bundledBinaries.ts` — 新增
- `src/main/utils/__tests__/bundledBinaries.test.ts` — 新增
- `src/main/services/FileStorage.ts` — 修改
- `src/main/mcpServers/filesystem/types.ts` — 修改

**步骤**：

1. 实现 platform/arch/Linux libc 候选选择、asar unpack 路径转换和明确错误。
2. 改造两处 ripgrep 消费者使用统一 resolver，filesystem MCP 直接 spawn binary。
3. 覆盖 Windows ARM64/x64、Linux glibc/musl、非法平台及当前宿主实际执行测试。

#### 子任务 P0.3 — Claude native 启动、peer API 与代理兼容

**目标**：把当前 `cli.js`/Node fork 启动迁移为 native binary，使升级后的源码重新可编译，并锁定 resolver 失败与代理透传语义。

**文件**：

- `src/main/services/agents/services/claudecode/index.ts` — 修改
- `src/main/services/agents/services/claudecode/__tests__/nativeRuntime.test.ts` — 新增或按现有测试结构采用等价窄测试
- `src/main/apiServer/services/messages.ts` — 修改
- `src/renderer/src/services/SpanManagerService.ts` — 修改
- `src/renderer/src/trace/dataHandler/MessageStreamHandler.ts` — 修改
- `src/main/services/proxy/__tests__/nodeProxy.test.ts` — 新增
- 仅在 typecheck 证明确有必要时修改企业版提交中的其他 peer API 兼容文件

**步骤**：

1. 移除 `cli.js`/Node `fork()`/proxy bootstrap 初始化，改用 `pathToClaudeCodeExecutable` 和 `stderr`；保留阶段 1 接入 shell policy 的明确插槽。
2. resolver 缺失时记录 loggerService 错误并在 `invoke()` resolve 后调度一次 Agent stream `type: 'error'`；窄测试必须先 `await invoke()`、再注册 listener，断言收到一次 error 且调用 Promise 不 reject。
3. 调整 Anthropic SDK `MessageStream`/messages 类型导入到新公开路径；新 MCP SDK 只做 typecheck 证明必要的最小 API 适配。
4. 验证 `getProxyEnvironment()` 只转发标准/Cherry proxy 键并丢弃空值；最终用户 env 优先级留到阶段 1 的 shell/env policy helper。

**阶段验收标准**：

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run --project main \
  src/main/utils/__tests__/bundledBinaries.test.ts \
  src/main/services/agents/services/claudecode/__tests__/nativeRuntime.test.ts \
  src/main/services/proxy/__tests__/nodeProxy.test.ts
pnpm test:scripts -- before-pack
pnpm format
pnpm build:check
pnpm build:unpack
bundle_root=$(find dist -type d -path '*app.asar.unpacked' -print -quit)
test -n "$bundle_root"
test -x "$(find "$bundle_root/node_modules" -type f \( -name claude -o -name claude.exe \) -print -quit)"
test -x "$(find "$bundle_root/node_modules/@cherrystudio/ripgrep" -type f \( -name rg -o -name rg.exe \) -print -quit)"
git diff --check
```

期望：lockfile 可冻结安装；当前宿主 Claude/ripgrep 在 node_modules 与 `app.asar.unpacked` 中都存在且可执行；平台过滤纯函数、resolver 失败 stream error、proxy 白名单、全量 lint/OpenAPI/tests 和 whitespace 检查通过。

**阶段验证 review**：由 clean-context Validation Reviewer 对照 D1、D3–D5、D8、非目标 2/3、invariant 1/4/5、diff、packaged-artifact inspection、validation ledger 和三个 Writer 的并行分派证据做有界验证。

### 阶段 1 — Windows Shell fallback 与 Git Bash 可选 UX 〔状态：✅ 已完成〕

**阶段依赖**：依赖阶段 0 已提供并验证的 native Claude 启动和新 SDK。

**并行性说明**：shell/env policy、`ClaudeCodeService` policy 接线和 AgentModal UX 分别落在独立文件集合；D2、D5、D6 已冻结 helper 签名、优先级和 UI 行为，Writer 可按契约并行实现。

**分派建议**：并行启动 3 个 Writer。P1.1 独占 shell/env helper 与 Git Bash 清理；P1.2 独占 `ClaudeCodeService` 接线；P1.3 独占 AgentModal 及测试。主执行者合并后只补冻结 helper contract 的窄类型胶水。

**范围**：在阶段 0 native runtime 上启用 Git Bash 优先/PowerShell fallback，明确用户 env 代理优先级，并解除 Git Bash 的 UI 硬门禁。

#### 子任务 P1.1 — Shell 环境选择与无效配置清理

**目标**：实现可单测的 Git Bash 优先/PowerShell fallback、最终用户 env 合并策略，并清除无效持久化路径。

**文件**：

- `src/main/services/agents/services/claudecode/runtimeEnv.ts` — 新增
- `src/main/services/agents/services/claudecode/__tests__/runtimeEnv.test.ts` — 新增
- `src/main/utils/process.ts` — 修改
- `src/main/utils/__tests__/process.test.ts` — 修改

**步骤**：

1. 实现大小写不敏感的托管环境键清理和两种 Windows shell 分支。
2. 返回 PowerShell fallback 下不可用的 Bash 工具列表。
3. 实现最终用户 env 合并：阻断认证、shell、Cherry internal proxy 键；允许现有完整 HTTP(S)/ALL/NO/SOCKS 大小写变体及 `grpc_proxy` whitelist 按 Agent 覆盖，Windows 下去除大小写重复键。
4. 无效 Git Bash 路径时双键清空，并覆盖 UI path info 返回值。

#### 子任务 P1.2 — ClaudeCodeService 接入 shell/env policy

**目标**：在阶段 0 native runtime 上接入 shell 选择、Bash 禁用和确定性用户 env 合并。

**文件**：

- `src/main/services/agents/services/claudecode/index.ts` — 修改

**步骤**：

1. 在合并 login shell env 与 process proxy env 后应用 D2 策略，再通过 P1.1 helper 合并 Agent 用户环境。
2. 把 PowerShell 托管键及 Cherry internal proxy 键纳入阻断集合，标准 proxy 键按 D5 允许确定性覆盖。
3. PowerShell fallback 时禁用 Bash 两种名称；保留 Git Bash、非 Windows、Soul mode 和现有全局禁用逻辑。

#### 子任务 P1.3 — 移除 Git Bash UI 门禁并补行为测试

**目标**：Windows 无 Git Bash 时 Agent 仍可保存；Git Bash 自动发现、手动选择和重置仍可使用。

**文件**：

- `src/renderer/src/components/Popups/agent/AgentModal.tsx` — 修改
- `src/renderer/src/components/Popups/agent/__tests__/AgentModal.test.tsx` — 新增，或按现有目录规范采用等价路径
- `src/renderer/src/i18n/locales/en-us.json` — 修改 Git Bash tooltip
- `src/renderer/src/i18n/locales/zh-cn.json` — 修改 Git Bash tooltip
- `src/renderer/src/i18n/locales/zh-tw.json` — 修改 Git Bash tooltip
- `src/renderer/src/i18n/translate/*.json` — 同步 Git Bash tooltip

**步骤**：

1. 移除 Git Bash required 标记、submit 早退和保存按钮 disabled，保留选择、重置和自动发现提示。
2. 把 tooltip/辅助文案从“Git Bash required”改为“Git Bash optional；缺失时使用 PowerShell”，同步全部 locale。
3. 覆盖 Windows + `{ path: null, source: null }` 时按钮可用且提交调用 add/update，并断言呈现的辅助文案不含 required 语义且明确 PowerShell fallback。
4. 覆盖有效 Git Bash 路径继续显示，并至少保留一条选择或重置交互测试。

**阶段验收标准**：

```bash
pnpm exec vitest run --project main \
  src/main/services/agents/services/claudecode/__tests__/runtimeEnv.test.ts \
  src/main/utils/__tests__/process.test.ts \
  src/main/services/proxy/__tests__/nodeProxy.test.ts
pnpm exec vitest run --project renderer \
  src/renderer/src/components/Popups/agent/__tests__/AgentModal.test.tsx
pnpm format
pnpm build:check
git diff --check
```

期望：Git Bash/PowerShell/非 Windows 三条环境路径、无效配置清理、标准 proxy 覆盖/内部键阻断和 AgentModal 无 Git Bash 提交行为通过；全量 lint/OpenAPI/tests 通过。

**阶段验证 review**：由 clean-context Validation Reviewer 对照 D2、D5–D8、非目标 1/2/5、invariant 1–4、diff、validation ledger 和三个 Writer 的并行分派证据做有界验证。

### 阶段 2 — PowerShell 工具模型、渲染与全仓验证 〔状态：✅ 已完成〕

**阶段依赖**：依赖阶段 1 已能产生 `PowerShell` tool call/result，并已冻结 Git Bash 可选语义。

**并行性说明**：后端工具/平台目录、消息卡片渲染、工具设置/i18n 分属不重叠文件集合；共同使用已冻结的工具 ID `PowerShell` 和 D6/D9 展示契约，可同时实施。

**分派建议**：并行启动 3 个 Writer。P2.1 独占后端工具、平台目录与 transform tests；P2.2 独占消息工具渲染与 tests；P2.3 独占 ToolsSettings 和 i18n。主执行者集成后运行格式化和全仓验证。

**范围**：让 PowerShell 在 Windows 权限设置、stream transform、消息路由和终端输出卡片中成为一等工具，同时保持非 Windows 工具目录不变，并完成全部仓库质量检查。

#### 子任务 P2.1 — 后端工具注册与流转换覆盖

**目标**：注册权限受控的 `PowerShell` metadata，仅在 Windows 对外暴露/运行时自动授权，并证明 tool call/result 在流转换中保留名称、参数与输出。

**文件**：

- `src/main/services/agents/services/claudecode/tools.ts` — 修改
- `src/main/services/agents/services/claudecode/__tests__/tools.test.ts` — 新增
- `src/main/services/agents/services/claudecode/__tests__/transform.test.ts` — 修改
- `src/main/services/agents/services/claudecode/index.ts` — 修改非 Windows runtime allowed filter
- `src/main/services/agents/BaseService.ts` — 修改
- `src/main/services/agents/tests/BaseService.test.ts` — 修改或新增等价平台目录测试

**步骤**：

1. 将 `PowerShell` 注册为 `requirePermissions: true` 的 builtin metadata。
2. 新增平台可参数化 exposed-tools/runtime-allowed helper；`BaseService` 在 Windows 暴露、在 macOS/Linux 过滤 PowerShell，`ClaudeCodeService` 从 `session.allowed_tools` 构造内部 `autoAllowTools` 和 SDK `options.allowedTools` 两个非 Windows 运行时副本时都过滤该 ID。
3. 数据库/API 中已有的 `allowed_tools: ['PowerShell']` 保持 opaque round-trip，不在 normalize/persist 层删除。
4. 添加 PowerShell call/result transform fixture，以及 Windows/非 Windows 工具目录、内部 auto-allow 与 SDK allowedTools 双通道过滤、opaque ID 不被回写破坏的断言。

#### 子任务 P2.2 — 消息工具路由与终端卡片

**目标**：正确渲染 PowerShell 命令/输出，并为未知 provider tool 保留通用 Agent renderer fallback。

**文件**：

- `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/BashTool.tsx` — 修改
- `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/index.tsx` — 修改
- `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/types.ts` — 修改
- `src/renderer/src/pages/home/Messages/Tools/MessageTool.tsx` — 修改
- `src/renderer/src/pages/home/Messages/Tools/ToolHeader.tsx` — 修改
- `src/renderer/src/pages/home/Messages/Tools/__tests__/MessageAgentTools.test.tsx` — 修改
- `src/renderer/src/pages/home/Messages/Tools/__tests__/MessageTool.test.tsx` — 新增

**步骤**：

1. 为 `PowerShell` 增加 input/output map、renderer、图标和 label。
2. 抽取 Bash/PowerShell 共用终端卡片逻辑，不改变 Bash 现有输出与截断语义。
3. 路由 provider tools，并覆盖 PowerShell、未来未知 provider tool、未知 builtin 三种行为。

#### 子任务 P2.3 — 工具描述与 i18n

**目标**：提供 PowerShell 用户可见描述和翻译，并为未来未知 builtin tool 保留 SDK description fallback。

**文件**：

- `src/renderer/src/pages/settings/AgentSettings/components/ToolsSettings.tsx` — 修改
- `src/renderer/src/pages/settings/AgentSettings/components/__tests__/ToolsSettings.test.tsx` — 新增
- `src/renderer/src/i18n/locales/en-us.json` — 修改
- `src/renderer/src/i18n/locales/zh-cn.json` — 修改
- `src/renderer/src/i18n/locales/zh-tw.json` — 修改
- `src/renderer/src/i18n/translate/*.json` — 通过仓库 i18n 流程同步

**步骤**：

1. 增加 PowerShell label 和 builtin description；未知 builtin description 回退 SDK 文本。
2. 按当前仓库 i18n 结构同步全部 locale，避免手工遗漏排序/模板键。

**阶段验收标准**：

```bash
pnpm exec vitest run --project main \
  src/main/services/agents/services/claudecode/__tests__/tools.test.ts \
  src/main/services/agents/services/claudecode/__tests__/transform.test.ts \
  src/main/services/agents/tests/BaseService.test.ts
pnpm exec vitest run --project renderer \
  src/renderer/src/pages/home/Messages/Tools/__tests__/MessageAgentTools.test.tsx \
  src/renderer/src/pages/home/Messages/Tools/__tests__/MessageTool.test.tsx \
  src/renderer/src/pages/settings/AgentSettings/components/__tests__/ToolsSettings.test.tsx
pnpm format
pnpm lint
pnpm test
pnpm build
pnpm build:check
git diff --check
git status --short
```

期望：新增定向测试和全量格式化、lint、test、build 全部成功；最终 diff 只包含本计划文件及 PowerShell/native SDK 闭环文件，不含企业专属内容或未说明生成物。

**阶段验证 review**：由 clean-context Validation Reviewer 对照 D1、D6、D8、D9、全部非目标、invariant 1/3/6、diff、validation ledger 和三个 Writer 的并行分派证据做有界验证。

### 阶段 3 — Native 模型与 shell 托管边界补全 〔状态：✅ 已完成〕

**阶段依赖**：依赖阶段 0–2、计划符合性 PASS，以及计划 v1 三轮 full review 已提交并复核的认证、remote/bridge、provider fallback 与 opaque ID 修复。D10 已冻结当前 native `2.1.185` 的 active 键集合，本阶段不再引入新产品决策。

**并行性说明**：实现与测试分别独占 `runtimeEnv.ts` 和 `runtimeEnv.test.ts`，共同使用 D10 的精确键集合与既有 helper contract，不互相等待；两个 subtask 必须在同一时间窗并行启动。主执行者只负责 diff 集成、验证账本与提交。

**分派建议**：并行启动 2 个 Fixer。P3.1 独占 production helper；P3.2 独占直接测试。两者不得修改对方文件，也不得扩展到 SDK、Agent 数据模型或设置 UI。

**范围**：闭合计划 v1 full review 第 3 轮发现的模型选择和 shell/进程启动覆盖路径；不处理 review 中仅列为 `EDGE_OR_OPTIONAL` 的异常 `builtin_PowerShell` ID，也不把未确认 active 的 schema-only 键纳入 runtime policy。

#### 子任务 P3.1 — 补全 managed model/shell 集合

**目标**：让继承环境和 Agent `env_vars` 都无法覆盖 D10 冻结的辅助/子代理模型与 shell wrapper 输入，同时保留应用规范值、标准 proxy、普通变量和输入对象不变。

**文件**：

- `src/main/services/agents/services/claudecode/runtimeEnv.ts` — 修改（独占）

**步骤**：

1. 抽取可读的 managed model-selector set，统一表达 4 个应用提供键和 3 个必须 scrub 的 active 键。
2. 把 `ANTHROPIC_SMALL_FAST_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`、`ANTHROPIC_DEFAULT_FABLE_MODEL` 加入 inherited scrub 与 Agent block。
3. 把 `CLAUDE_CODE_SHELL`、`CLAUDE_CODE_SHELL_PREFIX` 加入跨平台 inherited scrub 与 Agent block；不改变 D2 的 Git Bash/PowerShell 输出键。
4. 复用现有大小写不敏感匹配，不引入前缀通配或新的公开 API。

#### 子任务 P3.2 — 锁定模型与 shell failure path

**目标**：用参数化测试证明 D10 的 inherited、Agent 注入、大小写、应用值和兼容边界。

**文件**：

- `src/main/services/agents/services/claudecode/__tests__/runtimeEnv.test.ts` — 修改（独占）

**步骤**：

1. 对 3 个新增 active 模型选择器分别覆盖继承环境清理和 Agent 注入拒绝。
2. 对两个 shell 键覆盖 Windows/非 Windows、大小写变体、继承环境和 Agent 注入；证明 Git Bash/PowerShell 输出仍由 D2 helper 决定。
3. 断言 4 个应用提供模型键保留规范大写值、大小写 alias 被删除，标准 proxy 与普通变量保留，输入对象不变。
4. 明确不把 3 个 schema-only model 名称断言为 active policy，避免测试固化未经证实行为。

**阶段验收标准**：

```bash
pnpm exec vitest run --project main \
  src/main/services/agents/services/claudecode/__tests__/runtimeEnv.test.ts \
  src/main/services/agents/services/claudecode/__tests__/nativeRuntime.test.ts \
  src/main/utils/__tests__/process.test.ts
pnpm format
pnpm build:check
git diff --check
git status --short
```

期望：所有确认 active 的模型与 shell 输入在 inherited/Agent 两条通道被阻断；应用模型、Git Bash/PowerShell、标准 proxy 和普通变量行为不回归；全量 lint/OpenAPI/tests 通过。

**阶段验证 review**：由 clean-context Validation Reviewer 对照 D2、D5、D8、D10、非目标 1/2/5、invariant 2–4、diff、validation ledger 和两个 Fixer 的并行分派证据做有界验证。

---

## 执行中计划修订记录

| 版本 | 时间戳 | 触发原因 | 修订内容 | 后续门禁 |
|---|---|---|---|---|
| v1 | 2026-07-31T18:19:54+08:00 | 用户批准初始计划 | D1–D9、阶段 0–2 | 阶段执行、Plan Conformance、full review |
| v2 | 2026-07-31T20:16:38+08:00 | v1 full review 第 3 轮仍有 `MUST_FIX` | 扩充 invariant 4，新增 D10 与阶段 3，冻结 7 个 active 模型选择键和 2 个跨平台 shell 输入 | 阶段 3 Validation；Plan Conformance；以 v2 从 full review 第 1 轮重新开始 |

---

## 决策完备性 Review 记录

首轮 clean-context Reviewer 结论为 `NOT_READY_FOR_APPROVAL`，提出 5 个 `MUST_ADD` 和 2 个 `SHOULD_CLARIFY`；作者逐项裁决如下，没有丢弃项：

| Finding | 裁决与沉淀位置 |
|---|---|
| PowerShell 全局注册会改变非 Windows tool catalog | 成立；新增 D9、收紧 invariant 1，并在 P2.1 增加 `BaseService` 平台过滤和测试 |
| 最终 proxy env 优先级与大小写语义不明确 | 成立；D5/invariant 4 明确标准 proxy 允许 Agent 覆盖、Cherry internal 键禁止覆盖，P1.1/P1.2 增加确定性 merge helper 与测试 |
| 原验收未检查 packaged artifact | 成立；D8、P0.1 和阶段 0 验收加入 filter 纯函数测试、`pnpm build:unpack` 与 `app.asar.unpacked` executable inspection |
| 移除 Git Bash 门禁没有 AgentModal 行为测试 | 成立；D6 和 P1.3 增加 Windows 无 Git Bash 可提交、有效路径交互测试 |
| 各阶段提交前未运行仓库要求的 `pnpm build:check` | 成立；D8 和三个阶段验收均加入 `pnpm format` + `pnpm build:check` |
| Windows ARM64 是否保留 x64 ripgrep fallback 不明确 | 成立；D4/invariant 5 明确只保留原生 ARM64 Claude/ripgrep，并由 P0.1 filter 测试锁定 |
| native Claude binary 缺失的公开错误语义不明确 | 成立；D3 和 P0.3 明确转换为 Agent stream error，并增加 resolver failure 测试 |

二轮 clean-context Reviewer 复核后仍给出 `NOT_READY_FOR_APPROVAL`。其中首轮关于 proxy 优先级、packaged artifact、AgentModal 保存行为、阶段 `build:check` 和 Windows ARM64 的 finding 已确认闭合；其余及新增 finding 的裁决如下：

| Finding | 裁决与沉淀位置 |
|---|---|
| resolver 缺失测试只断言“不 reject”，不能证明订阅者收到 stream error | 成立；D3/P0.3 明确 `invoke()` resolve 后调度，测试按“await → 注册 listener → 收到一次 error”观察 |
| Git Bash tooltip/i18n 仍宣称 required | 成立；D6/P1.3 纳入全部 locale 和渲染断言，文案明确 optional + PowerShell fallback |
| 非 Windows `allowed_tools: ['PowerShell']` 持久化语义矛盾 | 成立；D9/invariant 1/P2.1 选择“opaque 存储/API 往返保留，catalog 与 runtime auto-allow 过滤”，避免数据丢失 |
| proxy whitelist 是否包含 SOCKS/gRPC 和大小写变体不明确 | 成立；D5/invariant 4/P1.1 明确保留 `nodeProxy.ts` 现有完整 whitelist |

三轮 clean-context Reviewer 只剩 1 个 `MUST_ADD`：社区版除内部 `autoAllowTools` 外，还把原始 `session.allowed_tools` 传给 SDK `options.allowedTools`。Finding 成立，已在 invariant 1、D9 和 P2.1 明确“opaque DB/API 值不回写清理，但非 Windows 的两个运行时副本都过滤 `PowerShell`”，并要求双通道测试。

四轮 clean-context Reviewer 聚焦复核 BaseService catalog、内部 `autoAllowTools`、SDK `options.allowedTools`、opaque DB/API round-trip、阶段并行性和 `build:check` 门禁，最终结论为 `READY_FOR_APPROVAL`。

---

## 风险与缓解

| 风险 | 可能性 | 缓解 |
|---|---|---|
| SDK `0.3.185` peer dependency 升级影响现有 Anthropic/MCP 类型 | 中 | 单列 P0.3，只做 typecheck 证明必要的最小兼容；每阶段跑全量 build:check，最终跑全量 test/build |
| 原生 Claude binary 在 asar/交叉构建中缺失 | 中 | optional package 全平台清单、asarUnpack、before-pack filter 单测、resolver 执行单测和 `build:unpack` 产物 inspection 共同覆盖 |
| Windows PowerShell fallback 仍暴露 Bash 导致模型选错工具 | 中 | 运行时显式禁用 `Bash`/`builtin_Bash`，新增纯函数单测和阶段 review invariant |
| native binary 失去 Node proxy bootstrap 后代理回归或覆盖次序不确定 | 中 | 标准/Cherry proxy env 白名单测试、最终 merge 优先级测试；保留现有 `getProxyEnvironment()` 入口 |
| ripgrep 路径迁移破坏文件搜索 | 中 | 两处消费者统一 resolver，当前宿主执行 `rg --version`，全量 main tests/build |
| PowerShell metadata 误暴露到 macOS/Linux | 中 | D9 分离权限 metadata 与 exposed catalog，参数化测试覆盖 Windows/非 Windows |
| i18n 键排序或语言文件漏同步 | 中 | 使用 `pnpm i18n:sync`/`pnpm format` 所属仓库流程，并由 `pnpm lint` 的 i18n check 验证 |
| macOS 无法证明 Windows 真实 PowerShell 进程端到端 | 高 | 平台参数化单测 + 企业版已合并实现作为行为参考；在交付说明中保留 Windows CI/实机验证建议，不伪装为已验证 |
| 并行 Writer 修改相邻工具类型文件产生语义冲突 | 低 | 按文件 ownership 拆分；工具 ID/环境 API 在 D2/D6 固定；主执行者只做窄集成 |
| Native SDK 新增未纳入托管边界的模型/shell 环境变量 | 中 | D10 使用当前版本确认 active 的显式集合；阶段 3 分离 production/test ownership；未来 SDK 升级重新核对 schema-only 与新增消费者，不使用危险通配 |

---

## 待决问题

无 — 计划 v2 已把 v1 full review 第 3 轮暴露的 native 模型选择与 shell wrapper 边界收敛为 D10 和阶段 3，不需要额外产品判断。
