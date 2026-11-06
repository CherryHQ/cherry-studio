# Agent Note: 关闭回归测试打开的外部应用

Status: proposed

[English](2026-11-06-e2e-external-app-cleanup.md) | 中文

## Problem

回归用例会打开不属于控制器所管理的 Cherry Studio 进程的原生应用。部分用例留下 Preview 文档、浏览器标签页、终端会话、文件管理器窗口或系统设置。即使用例通过，重复运行也会积累桌面状态。关闭记录中的应用进程，并不能证明这些外部资源已经关闭。

现有 [fixture](../../../../tests/e2e/regression/fixture.ts) 清理 Cherry Studio 的临时 UI。最终的[控制器清理](../../../../scripts/e2e/regression/cli.ts) 停止自身应用和 mock 服务。两者目前都没有管理用例打开的全部外部资源。

## Proposal

由[回归控制器](../../../../scripts/e2e/regression/README.md) 管理外部资源归属，用例在启动动作前后显式登记。本改动只涉及测试基础设施和用例，不改变产品正常的启动行为。

发出启动请求前，在运行目录的私有子目录持久记录启动意图、目标路径或唯一 URL，以及相关应用的基线。发出请求后，补齐实际文档、标签页、窗口和进程身份。即使启动验证失败，或者测试执行器在这两个步骤之间退出，保留的信息也应足以重试清理；仅有 PID 或进程名不构成归属证据。

除 PID 外还记录进程启动身份，并按资源类型记录文档路径、窗口标识或准确的浏览器标签页 URL。基线用于描述已有资源，但新观察到的资源仍需与已登记的启动请求关联。不能仅因某个窗口或进程在测试期间出现，就将其视为测试所有。

用例成功、断言失败和超时时，都在 teardown 关闭已登记的文档、标签页、窗口及 CLI 会话，并等待其消失。某项清理报错后，仍尝试其他独立资源；保留未解决记录以便重试，并在清理失败中报告残留资源身份和原因。关闭外部资源前先采集失败证据；报告中的 URL 和命令若含凭据，必须脱敏。

对于测试启动的应用，在其测试资源关闭后请求正常退出。等待超时后，只有记录中的进程身份仍匹配且没有无关内容时，才能强制终止。终止前立即重新验证，终止后验证退出。保留测试前已运行的应用及其已有或无关内容。Finder 和 Explorer 只清理窗口，绝不能终止其共享桌面进程。如果不能确认归属或不能确认没有无关内容，应报告未解决的清理，而不是杀死进程。

即使执行器已退出，或者应用、mock 服务清理失败，控制器最终清理也要重试持久记录。清理不能依赖仍存活的 Electron inspector。对于已经关闭的资源，重复清理必须保持幂等。强杀或宿主关机可能使清理代码无法执行；持久记录支持后续清理重试，不承诺没有执行器时立即恢复。

### Scenario coverage

| 用例或辅助入口 | 外部资源 | 清理要求 |
| --- | --- | --- |
| 已注册的 Code Mate CLI 启动用例 | Terminal／命令行窗口及 CLI 会话 | 关闭测试会话和窗口；测试启动的终端没有无关内容时退出 |
| MP-41 | 系统浏览器 HTML 标签页 | 按本轮唯一身份关闭标签页；测试启动的浏览器没有无关内容时才退出 |
| MP-70、MP-114 | Finder／Explorer 定位窗口 | 关闭登记的定位动作创建的窗口；保留已有窗口 |
| MP-77 | Preview PDF 和 Pages Word | 成功和失败时都关闭测试文档；安全时退出测试启动的应用 |
| MP-90 | Preview 图片或隔离的 Edge 浏览器 | 关闭测试文档或浏览器，验证 Windows 已有的浏览器清理 |
| MP-140 | 系统设置权限窗口 | 关闭测试创建的窗口；安全时退出测试启动的设置应用 |
| MP-97 | Terminal 权限验证会话 | 窗口发现失败时仍保留启动归属，验证会话和窗口关闭 |
| openExternalText/closeExternalText 调用方 | TextEdit 或 Windows 文本选择浏览器 | 关闭测试文档；安全时退出测试启动的应用；报告残留资源 |

[PR #23723](https://github.com/CherryHQ/cherry-studio/pull/23723) 中的 CODE-02 删除保持独立。实现覆盖其已验证基线中的已注册用例，不恢复已删除测试。现有用例必须继续验证真实外部启动，不能把产品动作替换为成功的 mock。不支持的原生清理必须给出明确失败原因，不能静默绕过用例。

## Alternatives considered

- 在各用例中分别增加关闭命令：单次改动较小，但没有共享的归属检查，也无法在执行器退出后恢复清理。
- 一轮结束后按应用名杀进程：简单，但可能丢弃用户文档并终止无关进程。
- 登记资源归属，并在用例和控制器边界清理：采用此方案，使重试、保留原有内容和实际关闭可以一起验证。

## Acceptance criteria

- AC1 — 成功、断言失败和超时时，teardown 关闭已登记的测试文档、标签页、窗口及 CLI 会话，并验证其消失。(verification: unit and Electron; owner: regression external-resource cleanup and affected scenarios)
- AC2 — 测试启动的独立应用正常退出；可控的不响应进程只有在重新确认归属且没有无关内容后才被强制终止，并验证退出。(verification: unit with real child processes and platform desktop acceptance; owner: native cleanup adapters)
- AC3 — 保留原本已运行的应用、已有或无关内容、共享文件管理器进程及被复用的 PID；归属不确定时报告未解决的清理。(verification: unit and platform desktop acceptance; owner: ownership checks and native cleanup adapters)
- AC4 — 一项清理失败不阻止其他资源的清理尝试；未解决记录被保留，重试可以完成，且不掩盖原始用例失败。(verification: unit; owner: cleanup coordinator and reporting)
- AC5 — 执行器退出，或启动后补齐身份前发生失败时，最终清理可以不依赖 Electron，从私有运行记录恢复已登记资源；重复清理容忍已经关闭的资源，其他清理失败也不能绕过它。(verification: unit with real record files and child processes, plus platform desktop acceptance; owner: launch registration and controller cleanup)
- AC6 — macOS 和 Windows 桌面证据证明覆盖范围内的外部启动、关闭、适用时的应用退出，以及原有内容的保留；单元测试和 Playwright 用例发现不能单独证明桌面验收通过。(verification: Electron and platform desktop acceptance; owner: affected scenarios and hosted regression workflow)

## Risks

原生自动化可能因权限、确认对话框或平台特有的应用行为失败。实现必须暴露这些失败并保留清理记录，不能大范围杀进程或声称成功。应用重启后，资源标识可能失效；身份检查必须区分资源已不存在和已被无关对象替代。

应用在测试启动后可能接收无关内容。即使进程最初由测试启动，此时也不能终止它；只能关闭所属测试内容，并报告剩余清理限制。系统浏览器可能复用已有窗口，因此必须独立于进程归属保留标签页身份。

验证使用明确的相关测试路径、真实记录文件和可控子进程检查清理契约，并运行 E2E 类型检查、修改文件的 lint／格式检查及清单与发现一致性检查。原生文档、标签页和窗口行为仍需真实 macOS 与 Windows 运行。本 Spec 不声称已经完成任一平台的桌面验收。
