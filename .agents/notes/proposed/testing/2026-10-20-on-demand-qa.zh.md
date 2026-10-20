# Agent Note: 按需桌面 QA

Status: proposed

[English](2026-10-20-on-demand-qa.md) | 中文

## Problem

[Issue #22055](https://github.com/CherryHQ/cherry-studio/issues/22055) 需要在单个托管平台上执行一条临时界面检查，无需添加回归清单用例或等待代码 PR。现有[回归控制器](../../../../scripts/e2e/regression/README.md)支持选择既有任务，但始终派发 macOS 和 Windows。其场景准备还会强制英语，使 QA 的中文选择器失效。

QA 会机械解析结果并回写跟踪表。断言失败、安装未完成、应用不可用、语言错误和任务取消必须保持可区分。失败分类只标识执行阶段，不能作为已确认产品缺陷的证据。

## Proposal

### 派发与归属

新增 `.github/workflows/qa-ondemand.yml`，控制器位于 `scripts/e2e/ondemand/`，经过评审的代码场景位于 `tests/e2e/ondemand/specs/`。默认 smoke 以 JSON plan 交付，不编写代码场景。QA 负责编写临时输入 plan；研发负责控制器和经过评审的代码场景。首期包含 smoke 和临时 plan 示例，不包含托盘、升级或 Linux 场景。

| 输入 | 契约 |
|---|---|
| `platform` | `windows` 或 `macos`；默认 `windows`；只使用所选的 `windows-2022` 或 `macos-latest` runner。 |
| `mode` | `branch` 或 `tag`；默认 `branch`；必须与解析后的 ref 类型一致。 |
| `ref` | 本仓库分支或 `v*` 发布 tag；默认 `main`；解析为精确提交。 |
| `spec` | 默认 `smoke`；必须符合 `^[a-z0-9][a-z0-9-]{0,40}$`；拒绝非法名称，不改写输入。 |
| `plan` | 可选 JSON，解析前最多 10,240 个 UTF-8 字节；更长的流程使用经过评审的代码场景。 |
| `timeout_minutes` | 整数，默认 45；branch 为 15–360，tag 为 1–360。拒绝更小值时解释分支准备的固定成本。 |

resolve job 在申请目标平台 runner 前校验输入。有 plan 时执行其步骤，`spec` 仅作为报告名称，不要求对应文件。无 plan 时，`smoke` 加载内置 JSON 模板；其他名称加载经过评审的代码场景。10 KiB 是本工具自身的限制，与 GitHub 的派发输入总量限制分开说明。

日常派发从 `main` 选择工作流，通过输入 `ref` 选择被测应用。控制器固定为 workflow SHA，应用固定为解析后的目标 SHA，两者都记录。固定 SHA 保证可复现；显式从其他分支派发工作流，仍然会选择该分支的控制器。test job 使用并发组 `qa-ondemand-<platform>-<spec>`、`cancel-in-progress: false` 和 `queue: max`；保留所有等待请求并逐个运行，不做去重。

### 运行时准备与就绪

复用既有控制器的可信 ref 解析、隔离路径、安装、进程归属、生命周期和 Windows CDP 准备逻辑。从 CLI 提取共用的 release 准备函数。按需状态和结果独立记录；直接调用底层函数，不虚构回归任务，也不初始化 `startup-smoke`。不安装无关代码工具，不执行回归阶段。

branch 模式准备应用依赖、二进制下载、Electron 原生依赖和 utility-process 构建。tag 模式下载并安装对应发布包。Windows 保留同步等待 NSIS `/S` 安装器成功退出的行为，随后才寻找可执行文件并启动。文件提前出现不代表安装完成。安装超时或非零退出属于准备失败。

应用就绪使用独立的 60 秒总预算，覆盖 CDP 可用、主窗口 target 和可交互的应用外壳或引导界面。按路径选择本次拥有的主窗口，不使用首个 CDP 页面。给共用生命周期增加可选的就绪和语言参数，不改变既有回归默认行为。普通操作和断言默认 15 秒。就绪失败为 `APP_NOT_READY`；执行期间丢失应用连接为 `APP_UNAVAILABLE`。

成功、失败或控制器可处理的取消发生后，只停止隔离运行目录中记录的应用。保留进程归属检查和 Windows CDP 兼容处理。干净 profile 的 smoke 接受引导界面，不要求 provider 凭据，也不静默完成引导。

### 语言与时区

中文是硬前置条件：workflow 设置 `LANG=zh_CN.UTF-8`，Electron 使用 `--lang=zh-CN`，通过现有 Preference API 设置 `app.language`。回读偏好、刷新，并在正常 i18n 初始化后验证中文界面标记。不复用英语回归准备，也不把静态 HTML 的 `lang` 属性当成应用当前语言。执行前、结束和失败采证时校验语言；不符时属于环境失败。经过评审的场景使用相同的中文准备 helper。

保留 runner 的时区配置。记录继承的时区配置以及控制器、主进程、renderer 的实际时区，其值默认不作为通过条件。plan 可以声明有效 IANA 时区标识 `requiredTimezone`；只有声明后，才要求应用主进程和 renderer 都与其匹配。不匹配或无法读取所要求的值，均属于环境失败。

环境采集和验证使用控制器自己的固定代码，不变成 plan 的 `script`、`evaluate` 或通用 IPC 动作。控制器的 `page.evaluate` 回调可以执行固定、经过评审的偏好操作并读取观测值；用户输入不得提供可执行源码。

### plan 与场景执行

plan 和每个步骤均使用严格 Zod 对象。要求非空 `steps` 数组，拒绝未知字段和动词，拒绝场景名和截图名中的路径穿越。plan 选项为 `continueOnFailure`（布尔值，默认 false）和可选的 `requiredTimezone`；语言固定为 `zh-CN`。

| 动词 | 参数与行为 |
|---|---|
| `click` | `text`：点击精确匹配的可见文本。 |
| `clickRole` | `role`、`name`：点击具有指定名称的无障碍角色。 |
| `fill` | `selector`、`text`：填写选定输入控件。 |
| `key` | `key`：发送 Playwright 键盘快捷键。 |
| `waitFor` | `selector`、可选 `timeout`：等待可见。 |
| `expectText` | `text`、可选 `timeout`：等待匹配的可见文本。 |
| `expectVisible` | `selector`、可选 `timeout`：使用重试断言可见性。 |
| `screenshot` | 可选的安全 `name`：在证据目录中生成遮罩截图。 |
| `sleep` | 可选 `ms`，默认 1,000：等待有限的非负时长。 |

使用 Playwright 既有的定位器、自动等待、键盘处理和断言，不自建自动化引擎。smoke plan 验证应用或引导界面已渲染并截图采证。经过评审的代码场景使用共用上下文、步骤记录器、截图函数和中文准备 helper，不能返回未经校验的通过结论。

默认遇到第一个失败步骤就停止，后续步骤标记为 `not_run`。设置 `continueOnFailure: true` 时继续收集操作和断言失败。应用退出、连接丢失和控制器错误仍终止执行。有失败、必需步骤未执行、阶段未完成或场景为空时，都不能通过。

### 结果与退出码

`results.json` 首版使用 `schemaVersion: 1`。稳定顶层字段为 `schemaVersion`、`status`、`exitCode`、`failureStage`、`errors`、`metadata`、`environment`、`timings`、`steps` 和 `artifacts`。`status` 为 `passed`、`failed` 或 `interrupted`；步骤状态为 `passed`、`failed` 或 `not_run`。无法取得的观测值使用 null 并记录原因，不虚构数值。

| 退出码 | 含义 |
|---|---|
| `0` | 准备、环境验证、所有必需步骤、报告和清理全部成功完成。 |
| `1` | 界面操作或断言未满足。 |
| `2` | 输入、环境、准备、安装、控制器、报告或清理失败。 |
| `3` | 应用未就绪，或执行期间应用连接不可用。 |

多类失败并存时使用优先级 `2 > 3 > 1 > 0`。`failureStage` 标识被选中失败的阶段；`errors` 保留所有原始失败，包括之后发生清理失败时的先前断言。阶段为 `input`、`prepare`、`environment`、`ready`、`steps`、`report` 和 `cleanup`；通过结果的失败阶段为 null。正常终止时，控制器、workflow 最终判定步骤和 JSON 的退出码一致。GitHub job 的成功或失败状态不承担数字分类。

工作开始前持久化当前阶段和暂定的中断结果，随阶段推进更新。捕获到信号后，保留 `status: interrupted` 和 `exitCode: null`，同时尝试清理和生成报告。强制杀死进程可能只留下最后快照；如果 runner 无法上传，也可能没有 artifact。消费者必须结合缺失或未完成的证据与 GitHub 的取消或超时状态判断，不虚构控制器退出码。

`metadata` 记录 workflow/controller SHA、应用 SHA、ref 和 mode。`environment` 记录 runner 标签、`ImageOS`、`ImageVersion`、OS/架构、运行实例的应用版本、语言和各进程时区。从运行实例读取应用版本，不使用 tag 或检出源码的版本替代。`timings` 分开记录准备、应用就绪和步骤耗时。无法采集的观测值保留原因。

schema version 1 内只允许新增可选字段，不删除、不改名、不改变类型或既有含义，包括枚举含义；不兼容变化必须升级 schema 版本。JSON 同时配套提供 `results.md`、job summary、遮罩截图和脱敏日志。绝不上传原始 plan、凭据或完整 profile。artifact 名为 `qa-ondemand-<spec>-<platform>-<sha7>`，保留 30 天，包含可取得的失败证据；上传后保留失败状态。

### 审批与 Linux 跟进

需求方明确要求 #22055 直接进入实现，不等待正式的 Spec Approval 门槛。此项任务授权仅针对本次变更，覆盖默认的 [Agent Note 规则](../../README.md)。最终实现为所有验收条件提供实际证据前，本记录保持 proposed。研发负责实现和 hosted 验证；QA 验收报告与派发契约。

本次 Spec 交付时在 #22055 记录 Linux 进入条件：工作流从 `main` 派发，Windows 的 branch/main 和 tag smoke 在连续三个运行日全部通过，每日至少各一次，合计至少六次成功，并有完整证据。按 `Asia/Shanghai` 的派发日期划分运行日。没有 smoke 派发的日期不计；运行日缺任一模式不能计入或跨过。相关失败或取消重置计数；等待中的运行和不完整证据不满足条件。控制器 SHA 可以变化，每次运行仍须记录。满足条件后，Linux 成为下一开发项，覆盖平台处理、AppImage 安装和启动、显示环境、进程管理及独立验收。这是进入条件，不代表增加一个平台常量就完成 Linux 支持。

## Alternatives considered

- 为每条临时测试扩充回归 task 清单：否决，因为仍需代码 PR，且保留双平台矩阵。
- 执行传入的 JavaScript 或 shell 命令：否决，因为工作流代码经过评审，并不能使任意输入代码安全。
- 增加顶层 `qa/` 目录并复制安装和进程控制：否决，沿用既有测试和控制器布局及归属 helper。
- 强制修改每台托管 VM 的时区：否决，普通中文界面检查不依赖时区；改为校验显式声明的时区要求。
- 仅根据日志或 job 成功状态分类失败：否决，QA 需要带版本的机器可读执行结果，并必须区分中断。
- 要求三个验证轮次使用完全不变的控制器 SHA 才进入 Linux：否决，无关变更会无限重置原本有效的证据。

## Acceptance criteria

- AC1 — 有效派发只选择一个 Windows/macOS runner 和一条测试；非法平台、mode/ref 不匹配、spec 名、超时、JSON 或超过 10,240 UTF-8 字节的 plan 均在申请目标 runner 前拒绝。(verification: unit + workflow contract; owner: development)
- AC2 — 没有对应场景文件的临时 plan 无需修改代码即可运行；默认 smoke 使用 JSON，其他无 plan 名称只选择经过评审的代码场景。(verification: unit + Electron; owner: development)
- AC3 — 控制器与应用 SHA 分别固定，branch/tag 准备复用本次拥有的隔离进程，不运行无关回归阶段或安装无关 CLI。(verification: unit + workflow contract + Electron; owner: development)
- AC4 — 安装器退出前即使生成可执行文件也不会提前触发启动；安装失败或超时返回准备失败码 2，已完成运行会清理本次拥有的进程。(verification: unit + packaged artifact; owner: development)
- AC5 — 应用语言错误时环境验证失败并返回码 2；应用偏好生效后验证中文界面标记，不把静态 HTML 语言标签当成证据。(verification: unit + Electron; owner: development)
- AC6 — 普通 plan 不因时区差异失败；显式要求时区后，任一应用进程不匹配或无法检查均返回码 2。(verification: unit + Electron; owner: development)
- AC7 — 应用超过独立的 60 秒就绪预算时返回码 3，普通操作或断言在 15 秒内未满足时返回码 1；控制器环境检查不接受任何可执行 plan 输入。(verification: unit + Electron; owner: development)
- AC8 — 严格 plan 拒绝未知字段和动词、空步骤及路径穿越；默认失败后停止并将后续步骤标为 not_run，continueOnFailure 收集后续失败，但未完成或失败的运行均不能通过。(verification: unit + Electron; owner: development)
- AC9 — 版本 1 报告保留稳定字段、区分运行环境与实际应用版本、分开记录准备和就绪及步骤耗时，并按 2 > 3 > 1 > 0 选退出码且保留全部失败。(verification: unit + report contract; owner: development)
- AC10 — 强制中断在可保存证据时体现为 null exitCode 和 interrupted 状态；缺失证据且 job 取消或超时时，绝不变成通过或虚构的控制器结果。(verification: unit + workflow contract; owner: development)
- AC11 — 已完成的 Windows/macOS branch/tag smoke 和临时 plan 验收运行提供可下载、保留 30 天的 JSON/Markdown、遮罩截图、脱敏日志及摘要，不包含原始 plan、凭据或 profile。(verification: packaged artifact + Electron; owner: development with QA acceptance)
- AC12 — 同平台和 spec 的请求保留等待任务且不取消运行中任务；#22055 记录 Linux 的三个运行日进入条件及逐次 SHA 和完整证据要求。(verification: workflow contract + docs gate + issue readback; owner: development)
- AC13 — 双语 Spec 通过文档和配对检查，记录需求方授权 #22055 跳过 Spec-first 实现门槛的例外，并在 hosted 验收证据完整前保持 proposed。(verification: docs gate + hosted evidence; owner: development and requesting maintainer)

## Risks

- branch 准备仍有固定成本；单条测试不代表完整 job 几分钟就能完成。镜像漂移和冷启动必须通过环境标识与耗时保持可见。
- 60 秒就绪预算可能暴露缓慢或损坏的启动；码 3 仅标识阶段，不判断原因属于产品还是环境。缺少所需 Preference 或运行时接口的旧版本明确失败，不添加 v1 兼容垫片或虚构观测值。
- 截图和应用日志可能包含输入的秘密。复用既有遮罩和脱敏 helper，涉及凭据时保持 trace 关闭，并限制上传路径。
- 取消可能在清理或上传前杀死控制器。暂定快照和 GitHub 终态界定可作出的结论；runner 被强制杀死后无法保证证据完整。
- 串行请求仍会消耗总 runner 时间，且 `queue: max` 受 GitHub 的有限队列容量限制。排队中的请求不属于已完成的验收证据。
