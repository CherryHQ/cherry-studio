import { app } from 'electron'

import { isLinux, isLinuxWayland, isWin } from '@main/core/platform'
import { bootConfigService } from '@main/data/bootConfig'

/**
 * Configure Chromium startup flags — the umbrella term Electron uses for
 * command-line switches and related APIs that affect how Chromium boots.
 *
 * All calls in this function must be made BEFORE app.whenReady() fires:
 * Chromium reads these once at startup and silently ignores later changes.
 * Callers must invoke this synchronously from main/index.ts during the
 * preboot phase, after bootConfigService has loaded.
 *
 * Covers both:
 *   - `app.commandLine.appendSwitch(...)` — raw Chromium switches
 *   - `app.disableHardwareAcceleration()` — Electron convenience API that
 *     maps to a Chromium GPU disable flag internally
 *
 * Electron docs reference:
 *   https://www.electronjs.org/docs/latest/api/command-line-switches
 *
 * See core/preboot/README.md for the preboot membership criteria.
 */
/** KDE sessions get KWallet from Chromium's own detection; leave them alone. */
function isKdeSession(): boolean {
  const { XDG_CURRENT_DESKTOP = '', DESKTOP_SESSION = '', KDE_FULL_SESSION } = process.env
  return Boolean(KDE_FULL_SESSION) || /kde/i.test(`${XDG_CURRENT_DESKTOP}:${DESKTOP_SESSION}`)
}

export function configureChromiumFlags(): void {
  // Disable hardware acceleration if the user opted out via BootConfig.
  if (bootConfigService.get('app.disable_hardware_acceleration')) {
    app.disableHardwareAcceleration()
  }

  // Windows: disable Chromium's native window-show animation. Prevents the
  // transparent SelectionAssistant toolbar from flashing on appear.
  // https://github.com/electron/electron/issues/12130#issuecomment-627198990
  if (isWin) {
    app.commandLine.appendSwitch('wm-window-animations-disabled')
  }

  // Linux Wayland: enable the xdg-desktop-portal global-shortcut backend so
  // globalShortcut.register() actually works under Wayland compositors.
  // https://www.electronjs.org/docs/latest/api/global-shortcut
  if (isLinuxWayland) {
    app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
  }

  // Linux (X11 and Wayland): set the window class/name so window managers
  // identify the app correctly in alt-tab switchers, docks, etc.
  if (isLinux) {
    app.commandLine.appendSwitch('class', 'CherryStudio')
    app.commandLine.appendSwitch('name', 'CherryStudio')
  }

  // Linux: Chromium uses plaintext key storage on desktops it doesn't recognise
  // (Hyprland, Sway, i3…). Prefer libsecret there; it falls back if unavailable.
  if (isLinux && !app.commandLine.hasSwitch('password-store') && !isKdeSession()) {
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
  }

  // Unconditional Chromium feature flags:
  // - DocumentPolicyIncludeJSCallStacksInCrashReports: capture JS call stacks
  //   when the renderer is unresponsive (paired with the web-contents-created
  //   handler in preboot/crashTelemetry.ts that sets the Document-Policy
  //   response header).
  // - EarlyEstablishGpuChannel + EstablishGpuChannelAsync: open the GPU IPC
  //   channel early to speed up first-paint.
  // - PageAllocatorRetryOnCommitFailure: retry memory page commits under
  //   transient commit pressure instead of failing immediately.
  // https://github.com/microsoft/vscode/pull/241640/files
  app.commandLine.appendSwitch(
    'enable-features',
    'DocumentPolicyIncludeJSCallStacksInCrashReports,EarlyEstablishGpuChannel,EstablishGpuChannelAsync,PageAllocatorRetryOnCommitFailure'
  )
}
