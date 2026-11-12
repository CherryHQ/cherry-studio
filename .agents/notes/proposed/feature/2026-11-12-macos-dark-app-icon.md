# Agent Note: macOS dark app icon

Status: proposed

English | [中文](2026-11-12-macos-dark-app-icon.zh.md)

## Problem

Cherry Studio ships one static macOS app icon, `build/icon.icns`, configured through the `mac:` block of `electron-builder.yml` (line 142). The Dock and Finder icon therefore never adapts to light or dark appearance, which issue #19703 reports as missing. The only dark-icon handling today is the tray icon: `src/main/services/TrayService.ts:58` switches between `tray_icon_light.png` and `tray_icon_dark.png` from `nativeTheme`. No dark app icon asset exists in `build/`.

Electron 45.2.2 exposes `app.dock.setIcon(icon: NativeImage | string)` (`node_modules/electron/electron.d.ts`). It takes a raster image or file path, so it cannot consume a macOS 26 Icon Composer `.icon` bundle. Runtime switching therefore swaps PNGs, and the Finder/Launchpad icon still comes from the bundle.

## Proposal

Switch the Dock icon at runtime between a light and a dark PNG, following the appearance the app already tracks.

- Add `build/icon-dark.png` (1024x1024) as the dark-appearance source. The existing `build/icon.icns` stays the light and bundle icon.
- In `ThemeService` (`src/main/services/ThemeService.ts`), on macOS only, call `app.dock?.setIcon(...)` at startup and on every `nativeTheme` `updated` event, passing the dark PNG when `nativeTheme.shouldUseDarkColors` is true and the light icon otherwise. The existing `themeUpdatedHandler` is the hook point.
- Keep the switch in one pure helper that maps the dark flag to an icon path, so the decision is unit-testable without Electron.
- Dock icon changes do not touch `WindowManager`'s dock visibility logic.

## Alternatives considered

- **Icon Composer `.icon` bundle in the packaged app.** Gives the system-managed dark and tinted variants on macOS 26+ and the Finder icon too. Rejected for this Spec because electron-builder 26.15.6 support is unverified, and it cannot be verified from this repo without a packaged macOS 26 build. It stays a candidate for a follow-up.
- **Two `.icns` files chosen at build time.** Only one icon can be bundled per app, so this cannot follow live appearance changes. Rejected.
- **Dark icon from a renderer-side preference.** Would make the Dock icon follow the in-app theme setting rather than the system appearance. Rejected because the issue asks for system appearance parity.

## Acceptance criteria

- AC1 — The helper returns the dark PNG when `nativeTheme.shouldUseDarkColors` is true and the light icon otherwise (verification: unit)
- AC2 — On Windows and Linux, `app.dock` is never called and no icon file is read by this path (verification: unit)
- AC3 — A missing dark PNG logs a warning and leaves the light icon in place without throwing (verification: unit)
- AC4 — On macOS, the live Dock icon follows the system appearance at startup and after a change (verification: Electron)
- AC5 — A packaged macOS build contains `build/icon-dark.png` as a resource and still uses `build/icon.icns` as the bundle icon (verification: packaged artifact)
- AC6 — The change is documented in the English and Chinese docs that describe macOS app icons, if any exist (verification: docs gate)

## Risks

- The Finder, Launchpad, and Cmd+Tab icons remain light-only. Users may read this as the feature being incomplete. The Spec scope is the Dock icon.
- `setIcon` may reset after the Dock hides or the app relaunches. AC1 covers startup, but the Dock hide/show path needs a manual check.
- A dark PNG that does not match the `.icns` design will look inconsistent. The asset needs design sign-off.
- A runtime icon change on macOS 26 may fight the system tinting. Verify on device before implementation is marked complete.
