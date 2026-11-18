# Agent Note: cherry-miniapp Skill 与 MiniApp 创作工作流

Status: implemented

[English](2026-11-13-cherry-miniapp-skill.md) | 中文

## Problem

用户可以安装 `.miniapp` 包并使用 `window.cherry`，但此前无法在 Cherry Studio 内从自然语言需求走到生成、测试、安装并可选择发布的 MiniApp。仅有生成的 HTML 或包并不能证明应用能在真实的 MiniApp 协议、CSP、桥接、权限和配额下运行。

在此工作之前：没有 `.agents/skills/cherry-miniapp/`；`public-skills.txt` 没有条目；`NewMiniAppPanel.tsx` 只提供 `site` 和 `app` 两个标签页；不存在 `mini_app` 代理工具、`miniapp-browser` 或 `mini_app.authoring.*` IPC。现有基础可复用：Skill 导入（`SkillInstaller`、`skillArchive`、`skillRemoteSource`）、MiniApp 安装（`features/miniApp/install/`）、运行时（`MiniAppRuntimeService`、`bridge`、`protocol`、`partition`）、能力（`features/miniApp/capabilities/`）、授权和活动日志。

本说明覆盖 #21646 的完整请求。它与 #19781 相关但不替代后者；#19781 拥有 Agent 创建的 Mini App 的本地创建 → 预览 → 安装流程。

## Decision

工作分四个独立合并的阶段交付，每个阶段自带测试。

### 阶段 1：Skill 与打包

公共 Skill 位于 `.agents/skills/cherry-miniapp/`，包含 `SKILL.md`、契约、测试和发布参考文档、静态模板、`window.cherry` 类型声明，以及校验和打包脚本。脚本检查清单、拒绝引用开发服务器的资源（包括超过 1 MiB 的文本资源）、构建确定性 ZIP 并计算 SHA-256 和大小。CLI 入口守卫通过 `pathToFileURL` 规范化 `process.argv[1]`，使文档记载的 `node <script>` 调用在 Windows 和带空格的目录中都能进入。ZIP 和 GitHub 导入复用现有 Skill 安装器；重复导入复用已安装的 Skill，绝不创建副本。

### 阶段 2：隔离预览与控制

预览在 `preview-` 运行时标识符下通过真实的 MiniApp 协议、CSP、能力桥接、权限检查和配额运行，拥有独立的临时目录、Electron 分区和授权，并保留清单标识。隔离是结构性的：`preview-` 命名空间使分区、协议主机和授权与任何已安装应用互不相交，122 位随机后缀配合注册表优先解析消除了碰撞。注册表位于内存中；关闭、替换或退出预览会取消请求、撤销控制目标并释放资源，被遗弃的目录树在启动时清扫。会话独占自己的预览目标。`validate` 只接受会话授权的构件路径，返回绑定包 SHA-256 的 `artifactToken`；预览和安装必须持有该令牌。自动化只能操作绑定的预览页面，没有任何能触及主机同意界面的动作。

### 阶段 3：创建与安装入口

“添加 Mini App”对话框新增“使用 Agent 创建”标签页。它直接绑定已安装的 Skill，并以预填需求草稿打开聊天会话，复用空的占位主题；当 Skill 缺失时，它只通过技能设置引导导入，绝不自行安装。`.miniapp` 构件卡片带有“预览并测试”和“安装到 Mini Apps”操作，卡片命名附件的文件句柄——主进程查找会话自己对该路径的令牌并在行动前重新核对摘要。预览同意、安装和添加到 Launchpad 是三个独立决定：点击构件即预览同意，安装走不变的安装同意对话框，安装后的“添加到 Launchpad”/“暂不”选择持久化在 `feature.mini_app.launchpad_prompt_dismissed` 中。预览数据、文件和权限绝不迁移到已安装应用。修复循环最多连续三轮自动修复；被封顶的包返回证据和恢复步骤，同意界面拒绝它直到一次校验成功。

### 阶段 4：发布工作流

发布仅在用户明确请求时运行；工作流先确认仓库所有者、许可证、应用 ID 和托管地址，默认为用户的公共 GitHub 仓库加 GitHub Pages。`scripts/publish.mjs manifest` 构建托管分发清单——打包清单（不得包含 `package`）加上取自最终测试包字节的 `package.url`、`package.sha256` 和 `package.size`——使用不可变路径 `apps/<id>/<version>/<id>-<version>.miniapp`；应用 ID 跨版本保留。`scripts/publish.mjs verify` 是回读闸门：托管清单、包和图标经 HTTPS 从同一来源读取且禁用重定向，任何摘要、大小或版本不匹配都会失败。上传本身不自动化。`scripts/check-directory-submission.mjs` 是官方目录的文档闸门：只能同时修改根部的双语 `README.md` 和 `README.zh-CN.md` 条目，重复的应用 ID 被拒绝；“已发布”“已提交”“已合并”保持为三个独立状态。没有创作工具的主机只获得生成和打包，并带有不声称真实运行时测试或安装的升级提示。

## Alternatives considered

- 只用社区 Builder 生成文件：作为完整方案被拒绝，因为它不提供主机集成的测试、直接安装或发布。它仍可作为参考。
- 只实现 #19781：被拒绝，因为它未解决独立的 Skill、绑定的测试证据、Launchpad 选择和发布。

## Consequences

预览证据是会话本地且结构性的，而非策略检查的；预览的任何内容都不会在重启后存活，这对遗弃状态是安全的方向。预览栈和同意界面的手动 Electron 验证未在创作环境中运行，留给拥有桌面构建的审查者。发布的上传步骤按设计保持手动和用户确认；脚本只准备和验证，绝不推送。没有创作工具的主机交付校验过的包及其 SHA-256，不声称测试或安装。

## Verification

- AC1 — Skill 可从 ZIP 和 GitHub 导入，重复导入复用已安装的 Skill 而不创建副本。证据：`src/main/ai/skills/__tests__/SkillService.test.ts` 通过 `installFromDirectory` 两次导入仓库真实的 `.agents/skills/cherry-miniapp`，断言单个目录行且 id 稳定；现有测试通过同一安装器覆盖 ZIP 和 GitHub 来源。
- AC2 — 打包拒绝无效清单或引用开发服务器的资源，并产出 SHA-256 和大小匹配的确定性 ZIP。证据：`scripts/__tests__/cherryMiniappSkill.test.ts`（11 个测试，`scripts` 项目）：模板通过校验；无效的 id/version/description 被拒绝；图标摘要不匹配被拒绝；回环资源引用被拒绝（包括超过 1 MiB 的文本资源）；network/permission 配对强制；打包跨次运行字节确定，SHA-256 和大小与写入文件匹配。
- AC3 — 预览通过真实协议、CSP、桥接和权限检查运行，拥有自己的运行时、临时目录、分区和授权，且不能读写同 ID 的已安装应用。证据：`src/main/features/miniApp/preview/__tests__/MiniAppPreviewService.test.ts` 在 `preview-` 运行时 id 下打开预览，拥有独立目录树、分区和授权并注册表优先解析；协议/CSP/桥接栈是已安装应用自身的，由 `runtime/__tests__` 覆盖（181 个测试）。Electron 部分未运行：无桌面环境。
- AC4 — 预览目标按会话绑定；关闭、替换或退出使其失效并取消在途请求；被遗弃的预览在启动时清理。证据：同一套件覆盖关闭-替换失效顺序、会话拆除关闭预览并撤销令牌、幂等的 `closePreview`、启动清扫和跨会话拒绝。
- AC5 — `validate` 返回绑定包 SHA-256 的 `artifactToken`；包字节改变的令牌被预览和安装拒绝。证据：`preview/__tests__/artifactTokens.test.ts` 和 `authoringRequests.test.ts`：令牌绑定会话 + SHA-256，被替换的字节以 `package-changed` 拒绝，未知和跨会话令牌被拒绝。
- AC6 — 自动化只操作绑定的预览页面，不能批准预览、安装或 Launchpad 同意。证据：`src/main/ai/tools/__tests__/miniappBrowser.test.ts`（10 个测试）：只有调用会话拥有的预览可寻址，无会话调用被拒绝，没有工具动作能触及主机同意界面；阶段 3 将同意保留在不变的用户对话框中。
- AC7 — “使用 Agent 创建”和构件卡片操作绑定正确的 Skill 和构件，不浏览内部数据目录，也不安装重复的 Skill。证据：`src/renderer/pages/miniApps/__tests__/CreateWithAgentTab.test.tsx` 和 `MiniAppArtifactActions.test.tsx`（5 个渲染器测试）：标签页绑定已安装的 Skill 并带草稿打开会话，缺失时引导导入，卡片将会话句柄传给两个操作。
- AC8 — 预览同意、安装和 Launchpad 固定是独立决定；“添加到 Launchpad”和“暂不”持久化并可回读。证据：`authoringRequests.test.ts`（9 个测试）覆盖 Launchpad 关闭去重和回读；渲染器测试覆盖卡片的 Launchpad 决定展示；偏好 `feature.mini_app.launchpad_prompt_dismissed` 持久化“暂不”。
- AC9 — 连续三轮修复失败后，安装和发布停止，返回的证据包含恢复步骤。证据：`preview/repairRounds.ts` 及 5 个测试，加上 `authoringRequests` 的拒绝：被封顶的包返回失败轮次的证据和恢复步骤，同意界面拒绝它。
- AC10 — 发布仅在用户明确请求时运行；托管清单、包和图标经 HTTPS 从同一来源回读且无重定向，摘要、大小和版本匹配。证据：`scripts/__tests__/cherryMiniappPublish.test.ts`（10 个发布测试）：清单构建器发出不可变路径和测试包身份，拒绝带 `package` 块的打包清单和非 https 基础地址；验证器接受匹配的发布，并在包字节被篡改、重定向、跨来源包 URL、版本不匹配和纯 http 时失败。
- AC11 — 目录提交只修改双语 README 条目，并将已发布、已提交和已合并报告为独立状态。证据：同一套件的 4 个文档闸门测试：仅条目的双语修改被接受；包、构建产物、单语言和嵌套 README 被拒绝；重复的应用 ID 被拒绝；CLI 分别报告三个状态。
- AC12 — 没有创作工具的主机只获得生成和打包，带有升级提示，且不声称真实测试或安装。证据：`CreateWithAgentTab.test.tsx` 断言缺失 Skill 的提示将主机限定为仅生成和打包；Skill 的 `references/testing.md` 指示没有工具的主机交付包及 SHA-256，并声明未进行真实运行时测试或安装。
