import { isLinux, isWin } from '@main/constant'
import { bootConfigService } from '@main/data/bootConfig'
import { app } from 'electron'

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
  if (isLinux && process.env.XDG_SESSION_TYPE === 'wayland') {
    app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
  }

  // Linux (X11 and Wayland): set the window class/name so window managers
  // identify the app correctly in alt-tab switchers, docks, etc.
  if (isLinux) {
    app.commandLine.appendSwitch('class', 'CherryStudio')
    app.commandLine.appendSwitch('name', 'CherryStudio')
  }

  // Unconditional Chromium feature flags:
  // - DocumentPolicyIncludeJSCallStacksInCrashReports: capture JS call stacks
  //   when the renderer is unresponsive (paired with the web-contents-created
  //   handler in preboot/crashTelemetry.ts that sets the Document-Policy
  //   response header).
  // - EarlyEstablishGpuChannel + EstablishGpuChannelAsync: open the GPU IPC
  //   channel early to speed up first-paint.
  // https://github.com/microsoft/vscode/pull/241640/files
  app.commandLine.appendSwitch(
    'enable-features',
    'DocumentPolicyIncludeJSCallStacksInCrashReports,EarlyEstablishGpuChannel,EstablishGpuChannelAsync'
  )
}
