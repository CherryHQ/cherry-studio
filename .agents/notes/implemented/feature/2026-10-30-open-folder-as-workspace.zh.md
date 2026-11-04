# Agent Note: 将文件夹作为智能体工作区打开

Status: implemented

[English](2026-10-30-open-folder-as-workspace.md) | 中文

## Problem

携带文件夹启动 Cherry Studio 时，应用不会将其注册或选为智能体工作区。智能体入口可能恢复记住的会话，而工作区控件又依赖已有会话。

## Decision

绝对目录操作数、目录的文件 URL 或 `cherrystudio://open?path=…` 会注册智能体工作区，或复用已有工作区的标识和名称。主进程打开 `/app/agents?workspaceId=<id>`。落地页按标识获取工作区，并检查现有的可见工作区列表，然后通过 `AgentChat` 独立于会话的 `centerSurface` 显示名称、路径和选中状态；不同会话列表布局及侧栏隐藏时均可见。现有的会话、预备意图和智能体标识保持优先；不带参数的智能体入口仍解析最近会话。

打开文件夹不创建会话、不启动对话运行时，也不执行任何操作。用户明确新建任务或选择智能体时，该工作区成为默认值。选择会话会替换落地页标识。工作区不存在、已删除、不可见或不可用时，页面回落到正常的智能体空界面，不弹出模态框、不产生渲染进程错误，也不激活最近会话。已被取代的异步流程不能激活会话；仍在等待工作区解析的流程会在创建会话前停止。拒绝启动输入后，应用仍正常打开。

Windows 安装程序在 `Software\Classes` 下写入资源管理器文件夹菜单项 `Directory\shell\CherryStudio`：按用户安装使用 HKCU，按计算机安装使用 HKLM，并在卸载时删除。它不是默认关联。Windows 11 可能将其放在“显示更多选项”中，不保证出现在顶层菜单。便携版不获得该菜单项。

Linux 打包会在软件包的桌面文件中加入 `inode/directory`，使 Cherry Studio 成为“打开方式”的候选应用。AppImage 运行时辅助程序有意保持不变；不声称未集成的 AppImage 能被自动发现。

macOS 支持通过 `open -b com.kangfenmao.CherryStudio --args <path>` 传入 argv，以及 `cherrystudio://open?path=…` 深链接。不声明 `public.folder`，也不集成服务或快速操作。不保证应用已经运行时，热调用 `open --args` 能传递参数。

## Alternatives considered

- 打开文件夹时创建空会话违反无会话约定，还可能在用户操作前启动运行时。
- 仅高亮工作区分组，会在其他布局或侧栏关闭时隐藏选中状态；现有中央插槽可以覆盖这些情况。
- 默认文件夹关联、macOS 文件夹声明或服务，以及 AppImage 运行时集成，都会将平台支持约定扩大到本功能之外。
- 用 realpath 替换工作区的词法路径标识，会改变现有注册语义。因此，对规范化后改变文件系统对象标识的输入选择静默拒绝。

## Consequences

现有工作区存储、可见性和 DataApi 约定已足够；不新增数据库结构、端点、存储或偏好设置。可见性检查需要在按标识读取的同时读取现有列表。明确指定的用户工作区创建默认值仍然优先；选中的落地页工作区会替代通用的系统工作区默认值。导航前已经发出的会话创建请求无法由渲染进程撤销，但它的延迟完成不能替换落地页。安装程序和桌面元数据仍需平台测试，才能确认实际文件管理器行为。

## Verification

仍需 Windows 和 Linux 机器验证安装、升级与卸载、资源管理器菜单位置、桌面入口发现和实际文件夹启动。本次交付尚未验证真实 Electron 图形界面，也未截取屏幕截图。

- Regression — `src/main/services/protocol/__tests__/launchInput.test.ts`：切片 A 已在 macOS 上运行，覆盖操作数选择、文件 URL、协议优先级和参数边界。
- Regression — `src/main/services/protocol/handlers/__tests__/openWorkspace.test.ts`：切片 A 已在 macOS 上使用真实文件系统和 SQLite 测试数据运行，覆盖工作区复用、校验、规范化对象标识和会话行未增加。
- Regression — `src/main/services/protocol/__tests__/ProtocolService.test.ts`：切片 A 已在 macOS 上运行，覆盖启动与深链接传递、就绪状态、渲染进程丢失、先进先出请求和畸形输入。
- Regression — `src/main/data/services/__tests__/AgentWorkspaceService.test.ts`：两个切片均在 macOS 上运行，覆盖注册和路径标识，切片 B 恢复了原有单例断言。
- Regression — `src/renderer/pages/agents/__tests__/routeSearch.test.ts`：切片 B 已在 macOS 上运行，覆盖工作区参数保留和现有标识优先级。
- Regression — `src/renderer/routes/app/__tests__/conversation-entry.test.ts`：切片 B 已在 macOS 上运行，覆盖仅含工作区的入口跳过会话解析，以及不带参数或限定智能体的入口仍按原规则解析。
- Regression — `src/renderer/pages/agents/__tests__/AgentPage.test.tsx`：切片 B 已在 macOS 上运行，覆盖不同布局下可见的名称和路径、静默空界面回退、会话选择、明确操作后的工作区默认值，以及抑制会话创建和过期激活。
- Regression — `scripts/__tests__/folder-opening-packaging.test.ts`：切片 A 已在 macOS 上运行，对 NSIS 归属、注册表分支选择、引号、卸载钩子和桌面 MIME 配置进行静态检查；这不代表安装程序或桌面运行时验证。
