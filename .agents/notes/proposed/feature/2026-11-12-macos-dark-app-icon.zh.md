# Agent Note: macOS 深色应用图标

Status: proposed

[English](2026-11-12-macos-dark-app-icon.md) | 中文

## Problem

Cherry Studio 在 macOS 上只提供一个静态应用图标 `build/icon.icns`，由 electron-builder 按 `electron-builder.yml` 中 `directories.buildResources: build` 下的默认图标名称解析；`mac:` 配置块未显式设置 `icon`。因此 Dock 和 Finder 图标不会随浅色或深色外观变化，这正是 issue #19703 反映的问题。目前唯一的深色图标处理是托盘图标：`src/main/services/TrayService.ts:58` 根据 `nativeTheme` 在 `tray_icon_light.png` 与 `tray_icon_dark.png` 之间切换。`build/` 中不存在深色应用图标资源。

Electron 45.2.2 的 `app.dock.setIcon(icon: NativeImage | string)`（见 `node_modules/electron/electron.d.ts`）只接受位图或文件路径，无法使用 macOS 26 Icon Composer 的 `.icon` 包。因此运行时切换只能替换 PNG，Finder 和 Launchpad 图标仍来自应用包。

## Proposal

根据独立于应用内主题覆盖的操作系统外观，在运行时于浅色和深色 PNG 之间切换 Dock 图标。这是提议的契约，不表示现有 ThemeService 已提供该信号。

- 新增 `build/icon-dark.png`（1024x1024）作为深色外观源文件。现有 `build/icon.icns` 保持为浅色和应用包图标。
- 新增仅用于 macOS 的操作系统外观适配器，提供初始读取和变更订阅，且独立于 `nativeTheme.themeSource` 和 `ui.theme_mode`。使用其系统深色标志在启动及系统外观变化后调用 `app.dock?.setIcon(...)`，随服务销毁订阅。实现前必须在受支持 macOS 版本上验证真正源自系统的信号；具体平台 API 仍是实现前置条件。
- 不得将现有 `ThemeService.themeUpdatedHandler` 或 `nativeTheme.shouldUseDarkColors` 用作系统信号：ThemeService 根据应用偏好设置 `nativeTheme.themeSource`，强制应用主题会在系统外观未变时改变该标志。也不得通过临时修改应用主题读取系统信号。
- 将切换决策放在一个纯函数辅助方法中，它把深色标志映射为图标路径，使其无需 Electron 即可单元测试。
- Dock 图标变更不改动 `WindowManager` 的 Dock 显隐逻辑。

## Alternatives considered

- **在应用包中使用 Icon Composer `.icon` 包。** 可在 macOS 26+ 上获得系统管理的深色和着色变体，Finder 图标也会随之变化。本 Spec 暂不采用，因为 electron-builder 26.15.6 的支持情况未经验证，且没有 macOS 26 打包构建就无法在本仓库中验证。可作为后续候选。
- **构建时选择两个 `.icns` 文件。** 每个应用只能打包一个图标，无法跟随实时外观变化。不采用。
- **由渲染进程的偏好设置决定深色图标。** 会让 Dock 图标跟随应用内主题设置，而非系统外观。不采用，因为 issue 要求与系统外观保持一致。

## Acceptance criteria

- AC1 — 辅助方法根据适配器的系统深色标志返回深色 PNG，否则返回浅色图标；对两种系统外观分别测试应用的 system、light、dark 偏好，包括系统与应用相反的组合（verification: unit）
- AC2 — Windows 和 Linux 上，此路径从不调用 `app.dock`，也不读取图标文件（verification: unit）
- AC3 — 深色 PNG 缺失时记录警告并保留浅色图标，不抛出异常（verification: unit）
- AC4 — macOS 上，应用被强制设为相反主题时，Dock 图标仍在启动及系统外观变化后跟随系统；只改应用偏好不得切换 Dock 图标（verification: Electron）
- AC5 — macOS 打包构建包含 `build/icon-dark.png` 资源，且应用包图标仍为 `build/icon.icns`（verification: packaged artifact）
- AC6 — 若存在描述 macOS 应用图标的英文与中文文档，则同步更新（verification: docs gate）

## Risks

- 接受实现前必须在受支持 macOS 版本上证明外观来源及其订阅独立于应用主题覆盖。本提议不声称现有 Electron 标志已满足要求。

- Finder、Launchpad 与 Cmd+Tab 图标仍只有浅色版本。用户可能认为功能不完整。本 Spec 的范围仅限 Dock 图标。
- Dock 隐藏或应用重启后，`setIcon` 设置可能被重置。AC1 覆盖启动场景，但 Dock 隐藏/显示路径需要手动验证。
- 深色 PNG 若与 `.icns` 设计风格不一致会显得突兀，资源需要设计确认。
- macOS 26 上运行时切换图标可能与系统着色冲突，需在实机验证后才能标记为完成。
