# Agent Note: macOS 深色应用图标

Status: proposed

[English](2026-11-12-macos-dark-app-icon.md) | 中文

## Problem

Cherry Studio 在 macOS 上只提供一个静态应用图标 `build/icon.icns`，由 `electron-builder.yml` 的 `mac:` 配置块（第 142 行）引用。因此 Dock 和 Finder 图标不会随浅色或深色外观变化，这正是 issue #19703 反映的问题。目前唯一的深色图标处理是托盘图标：`src/main/services/TrayService.ts:58` 根据 `nativeTheme` 在 `tray_icon_light.png` 与 `tray_icon_dark.png` 之间切换。`build/` 中不存在深色应用图标资源。

Electron 45.2.2 的 `app.dock.setIcon(icon: NativeImage | string)`（见 `node_modules/electron/electron.d.ts`）只接受位图或文件路径，无法使用 macOS 26 Icon Composer 的 `.icon` 包。因此运行时切换只能替换 PNG，Finder 和 Launchpad 图标仍来自应用包。

## Proposal

根据应用已跟踪的外观，在运行时于浅色和深色 PNG 之间切换 Dock 图标。

- 新增 `build/icon-dark.png`（1024x1024）作为深色外观源文件。现有 `build/icon.icns` 保持为浅色和应用包图标。
- 在 `ThemeService`（`src/main/services/ThemeService.ts`）中，仅在 macOS 上，于启动时以及每次 `nativeTheme` `updated` 事件时调用 `app.dock?.setIcon(...)`：`nativeTheme.shouldUseDarkColors` 为真时传入深色 PNG，否则传入浅色图标。现有的 `themeUpdatedHandler` 即为挂接点。
- 将切换决策放在一个纯函数辅助方法中，它把深色标志映射为图标路径，使其无需 Electron 即可单元测试。
- Dock 图标变更不改动 `WindowManager` 的 Dock 显隐逻辑。

## Alternatives considered

- **在应用包中使用 Icon Composer `.icon` 包。** 可在 macOS 26+ 上获得系统管理的深色和着色变体，Finder 图标也会随之变化。本 Spec 暂不采用，因为 electron-builder 26.15.6 的支持情况未经验证，且没有 macOS 26 打包构建就无法在本仓库中验证。可作为后续候选。
- **构建时选择两个 `.icns` 文件。** 每个应用只能打包一个图标，无法跟随实时外观变化。不采用。
- **由渲染进程的偏好设置决定深色图标。** 会让 Dock 图标跟随应用内主题设置，而非系统外观。不采用，因为 issue 要求与系统外观保持一致。

## Acceptance criteria

- AC1 — 当 `nativeTheme.shouldUseDarkColors` 为真时辅助方法返回深色 PNG，否则返回浅色图标（verification: unit）
- AC2 — Windows 和 Linux 上，此路径从不调用 `app.dock`，也不读取图标文件（verification: unit）
- AC3 — 深色 PNG 缺失时记录警告并保留浅色图标，不抛出异常（verification: unit）
- AC4 — macOS 上，Dock 图标在启动时及外观变化后跟随系统外观（verification: Electron）
- AC5 — macOS 打包构建包含 `build/icon-dark.png` 资源，且应用包图标仍为 `build/icon.icns`（verification: packaged artifact）
- AC6 — 若存在描述 macOS 应用图标的英文与中文文档，则同步更新（verification: docs gate）

## Risks

- Finder、Launchpad 与 Cmd+Tab 图标仍只有浅色版本。用户可能认为功能不完整。本 Spec 的范围仅限 Dock 图标。
- Dock 隐藏或应用重启后，`setIcon` 设置可能被重置。AC1 覆盖启动场景，但 Dock 隐藏/显示路径需要手动验证。
- 深色 PNG 若与 `.icns` 设计风格不一致会显得突兀，资源需要设计确认。
- macOS 26 上运行时切换图标可能与系统着色冲突，需在实机验证后才能标记为完成。
