# Agent Note: 拒绝在安装目录内注册智能体工作目录

Status: implemented

[English](2026-11-09-agent-workspace-install-directory.md) | 中文

## 问题

Issue #23938 报告 Windows 应用内升级删除了 `D:\Cherry Studio\work` 这样的智能体工作目录，而父安装目录仍然存在。将用户文件注册到安装目录下会使其面临安装器清理。

## 根因

`electron-builder.yml:117–135` 选择 NSIS 并允许自定义安装目录。`src/main/services/AppUpdaterService.ts:490–493` 调用 `autoUpdater.quitAndInstall(true, true)`。上游 `app-builder-lib/templates/nsis/uninstaller.nsh:164–188` 将旧安装文件移入 `$PLUGINSDIR\old-install`，随后无条件执行 `RMDir /r $INSTDIR`；静默模式不会跳过清理。`build/nsis-installer.nsh` 没有提供 `customRemoveFiles` 覆盖。因此，`$INSTDIR` 下的文件会被删除，与应用自身的工作目录清理无关。

## 决定

`src/main/ai/agents/agentWorkspaceInstallDirectory.ts` 使用已有的 `isSameOrInside` 判定函数实现纯策略。`AgentWorkspaceStorageService.registerWorkspace` 在 reservation 检查或数据库写入之前，拒绝等于或位于 `application.getPath('app.install')` 内的路径。打包的非便携版执行此策略。便携版刻意将数据与应用放在一起且不执行应用内升级；未打包的开发模式也予以豁免。安装目录信息缺失或不是绝对路径时允许注册。

注册 IPC handler 将 `WorkspaceInstallDirectoryError` 映射为 `AI_AGENT_WORKSPACE_INSTALL_DIRECTORY` 并携带两个路径。工作目录选择器和会话创建显示本地化提示，要求选择安装目录之外的目录。仅操作数据库的服务、已有工作目录 ID 绑定、迁移 SQL 和安装器保持各自职责。

## 考虑过的替代方案

- 在 NSIS 清理中保留未知子目录：替换时会混合新旧安装文件，无法验证保留边界。
- 启动时自动迁移工作目录：移动用户文件并重新绑定持久化路径，需要独立的迁移与恢复设计。
- 只警告而不拒绝注册：用户仍可能注册会被下次升级删除的文件。

## 代价

已有记录不会自动迁移；用户下次通过注册入口选择该目录时才收到拒绝提示。已有会话继续使用工作目录 ID 绑定。这项修复无法恢复已被安装器删除的文件。安装信息未知时放行。共享判定函数使用宿主平台的大小写折叠与词法包含判断；文件系统身份与符号链接解析不属于此策略。

## 验证

- Regression — 策略和渲染层错误：2 个文件、72 条测试通过，覆盖 Windows 路径、相等、后代、相似兄弟目录、大小写变体、祖先目录、其他盘符、开发模式、便携版、缺失信息、本地化提示和缺失路径时的格式。
- 定向主进程与错误测试：5 个文件、169 条测试通过，覆盖真实迁移后的 SQLite 持久化、拒绝后没有工作目录记录、存储仍可预留、目录外注册、IPC 错误数据和其他失败。
- 渲染层消费链：WorkspaceSelector 和 Sessions 共 2 个文件、157 条测试通过；拒绝后保留选择并显示恢复提示。共享的可操作错误格式化逻辑覆盖会话创建。
- 修改文件的 ESLint、全部语言的 i18n 校验及仓库文档闸门通过。未执行 Windows 打包安装器或交互式 Electron 升级。
