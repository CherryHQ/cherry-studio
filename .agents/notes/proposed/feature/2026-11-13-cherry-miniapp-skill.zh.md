# Agent Note：cherry-miniapp Skill 与 MiniApp 创作工作流

Status: proposed

[English](2026-11-13-cherry-miniapp-skill.md) | 中文

## Problem

用户可以安装 `.miniapp` 包并使用 `window.cherry`，但无法在 Cherry Studio 内完成从自然语言需求到生成、测试、安装并可选发布 MiniApp 的完整流程。仅生成 HTML 或安装包，无法证明应用能在真实的 MiniApp 协议、CSP、桥接、权限和配额下运行。

当前状态（以 `4cd7953b26` 检查）：不存在 `.agents/skills/cherry-miniapp/`；`public-skills.txt` 中没有对应条目；`NewMiniAppPanel.tsx` 只提供 `site` 和 `app` 两个标签页；不存在 `mini_app` 智能体工具、`miniapp-browser` 或 `mini_app.authoring.*` IPC。现有基础设施可以复用：Skill 导入（`SkillInstaller`、`skillArchive`、`skillRemoteSource`）、MiniApp 安装（`features/miniApp/install/`）、运行时（`MiniAppRuntimeService`、`bridge`、`protocol`、`partition`）、能力实现（`features/miniApp/capabilities/`）、授权与活动日志。

本 Note 覆盖 #21646 提出的完整需求。它与 #19781 相关但不替代后者；#19781 负责智能体创建的 MiniApp 在本地完成创建、预览、安装的流程。与 #19781 的重叠由下方未决事项解决。

## Proposal

工作分四个阶段交付。每个阶段可独立合并，并附带各自的测试。

### 阶段 1：Skill 与打包

在 `.agents/skills/cherry-miniapp/` 新增公开 Skill，包含 `SKILL.md`、契约、测试与发布参考文档、静态模板、`window.cherry` 类型声明，以及校验和打包脚本。脚本检查 manifest，拒绝引用开发服务器的资源，构建确定性的 ZIP，并计算 SHA-256 与大小。只有模板通过校验和打包后，才会在 `public-skills.txt` 中登记该 Skill。

ZIP 与 GitHub 导入复用现有 Skill 安装器。重复导入时复用已安装的 Skill，不会创建重复项。

### 阶段 2：隔离预览与控制

预览使用真实的 MiniApp 协议、CSP、能力桥接、权限检查和配额。预览拥有独立的运行时标识、临时目录、Electron partition 和授权，同时保留 manifest 身份。预览的存储与文件后端均为临时的。关闭、替换或退出预览时，取消请求、撤销控制目标并释放资源。启动时清理遗留的预览。

每个聊天会话持有自己的预览目标，会话之间不能相互控制。关闭、替换或切换产物会立即使旧目标失效。

宿主工具：

| 接口 | 职责 |
|---|---|
| `mini_app` | `validate`、`preview`、`status`、`install`、`pin`、`close` |
| `miniapp-browser` | 快照、点击、输入、等待、日志和截图，仅限绑定的预览页面 |
| `mini_app.authoring.*` IPC | 预览与安装请求、授权状态、结果通知 |

`validate` 只接受当前会话已授权的产物路径，并返回绑定到包 SHA-256 的 `artifactToken`。预览和安装都必须携带该令牌。自动化从不与宿主的权限或安装确认对话框交互。预览中的 AI 调用使用现有的默认与快速模型槽位并记录用量；未配置模型时显示配置提示。

### 阶段 3：创建与安装入口

添加 MiniApp 对话框新增"使用智能体创建"标签页。它直接绑定已安装的 Skill，或引导用户先导入，然后打开带有需求草稿的会话。`.miniapp` 产物卡片新增"预览并测试"和"安装到 MiniApp"操作，直接传入会话中的产物。

预览授权、安装和添加到启动台是三个独立的用户决定。预览的数据、文件和权限不会迁移到已安装应用。`enabled` 控制列表状态，`pinned` 控制启动台。安装时重新校验令牌所绑定的摘要，拒绝损坏或被替换的包。

修复循环最多允许连续三轮自动修复。第三次失败后，停止安装和发布，并由会话返回证据与恢复步骤。

### 阶段 4：发布流程

只有在用户明确请求时才发布。发布前确认仓库所有者、许可证、应用 ID 和托管地址；默认使用用户的公开 GitHub 仓库与 GitHub Pages。分发 manifest 增加下载 URL、SHA-256 和大小；打包后的 manifest 不包含 `package`。每个版本使用新的不可变包路径，并保持应用 ID 不变。

发布后，通过 HTTPS 回读托管的 manifest、包和图标，要求同源且无重定向。摘要、大小和版本必须与最终测试过的包一致。随后从公开 URL 安装应用并验证。

官方目录 PR 只修改 `README.md` 与 `README.zh-CN.md` 中对应的条目，不上传包或构建产物。工作流会先检查已有条目和 PR。"已发布"、"已提交"和"已合并"作为三种独立状态报告。

## Alternatives considered

- 仅使用社区 Builder 生成文件：不作为完整方案，因为它不提供宿主集成的测试、直接安装或发布流程；可作为参考。
- 只实现 #19781：不采用，因为它未覆盖独立 Skill、绑定的测试证据、启动台选择和发布。
- 在普通浏览器或 HTML iframe 中预览：不采用，因为无法验证 `window.cherry`、权限、存储隔离或安装。
- 将 Skill 打包进应用或向官方目录仓库上传包：不采用，因为这与独立导入及目录的托管边界相冲突。

## Acceptance criteria

- AC1 — Skill 可从 ZIP 和 GitHub 导入；重复导入复用已安装的 Skill，不创建重复项。 (verification: unit; owner: Backend)
- AC2 — 打包会拒绝无效 manifest 或引用开发服务器的资源，并生成 SHA-256 与大小一致的确定性 ZIP。 (verification: unit; owner: Backend)
- AC3 — 预览通过真实的协议、CSP、桥接和权限检查运行，拥有独立的运行时、临时目录、partition 和授权，且无法读写同 ID 的已安装应用。 (verification: unit and Electron; owner: Backend)
- AC4 — 预览目标按会话绑定；关闭、替换或退出会使其失效并取消进行中的请求；启动时清理遗留预览。 (verification: unit; owner: Backend)
- AC5 — `validate` 返回绑定到包 SHA-256 的 `artifactToken`；包字节变化后，预览和安装都会拒绝该令牌。 (verification: unit; owner: Backend)
- AC6 — 自动化只能操作绑定的预览页面，无法批准预览、安装或启动台授权。 (verification: unit and Electron; owner: Backend and QA)
- AC7 — "使用智能体创建"和产物卡片操作绑定正确的 Skill 与产物，无需浏览内部数据目录，也不会安装重复的 Skill。 (verification: renderer and Electron; owner: Frontend)
- AC8 — 预览授权、安装和启动台固定是三个独立决定；"添加到启动台"和"暂不"的选择可持久化并回读。 (verification: unit and renderer; owner: Frontend and Backend)
- AC9 — 连续三轮修复失败后，停止安装和发布，返回的证据包含恢复步骤。 (verification: unit; owner: Backend)
- AC10 — 只有用户明确请求时才发布；托管的 manifest、包和图标通过 HTTPS 从同源回读，且无重定向，摘要、大小和版本与测试包一致。 (verification: packaged artifact; owner: Backend)
- AC11 — 目录提交只修改双语 README 条目，并将"已发布"、"已提交"和"已合并"作为独立状态报告。 (verification: docs gate; owner: Maintainer)
- AC12 — 不支持授权工具的宿主只提供生成与打包功能，并给出升级提示，不声称已完成真实测试或安装。 (verification: renderer; owner: Frontend)

## Risks

- 预览隔离可能因共享 partition 或存储根目录而泄漏到已安装应用。测试必须断言目录与 partition 互不相同。
- 自动化可能触及宿主确认对话框。目标必须只暴露绑定的预览页面。
- 重新打包的产物可能复用旧报告。令牌绑定 SHA-256，任何重新打包都会使其失效。
- 范围跨越四个阶段，涉及 MiniApp 运行时、安装和 IPC 层。每个阶段必须在有证据的情况下合并，才能开始下一阶段。

进入阶段 2 前的未决事项：是否基于 #19781 构建还是与其并行；预览注册表是否持久化以支持启动清理，还是保留在内存中；发布只通过脚本完成，还是通过智能体调用 `gh` 完成。
