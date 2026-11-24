/* eslint-disable no-restricted-syntax -- preboot gate runs before LoggerService
 * exists (file transports would create %APPDATA%/<App>/logs); console is the
 * only filesystem-safe sink on the rejection path. */
import os from 'node:os'

import { app, dialog } from 'electron'

import {
  MIN_SUPPORTED_WINDOWS_VERSION_LABEL,
  WINDOWS_SUPPORT_RELEASES_URL,
  isSupportedWindowsRelease
} from '@shared/utils/osSupport'

/**
 * Minimum NT release for update manifests (`latest.yml`).
 * electron-updater compares this against the client's local `os.release()`
 * and withholds the update when the client is older — this is what protects
 * old (pre-gate) clients that send no `X-OS-Release` header.
 */
export const MIN_SUPPORTED_WINDOWS_NT_RELEASE = '10.0.17763'

function currentOsReleaseLabel(osRelease: string): string {
  if (process.platform !== 'win32') return process.platform
  return `Windows (NT ${osRelease})`
}

/**
 * Pre-ready-safe language signal.
 *
 * `app.getLocale()` must not be called here: Electron documents `ready` as a
 * precondition, so before `ready` it can return an empty locale or throw and
 * a translated-Windows user would get English-only instructions.
 * `app.getPreferredSystemLanguages()` is safe during preboot.
 */
function isChinesePreferred(): boolean {
  try {
    const preferred = app.getPreferredSystemLanguages?.() ?? []
    const first = preferred[0] ?? ''
    return first.toLowerCase().startsWith('zh')
  } catch {
    return false
  }
}

/**
 * Block startup on unsupported Windows releases before any userData work.
 *
 * Timing contract:
 *   - Must run BEFORE `resolveUserDataLocation()` in `main/main.ts`, and —
 *     critically — before any import that initializes profile-backed logging.
 *     `LoggerService` constructs winston-daily-rotate-file transports at import
 *     time, and the rotation stream creates `%APPDATA%/<App>/logs` plus its
 *     audit file when registering a new daily log. So this module must stay
 *     dependency-free: no `@logger`, no `@application`, no `@main/i18n`
 *     (whose resolver pulls `application`/PreferenceService and `getLocale`).
 *     It only reads `os.release()` / `process.platform` and shows a modal —
 *     it never touches the filesystem, BootConfig, or the path registry.
 *   - `main.ts` imports `osSupportEarlyGate` FIRST so this check executes
 *     during module evaluation, before `bootConfig`/`loggerService` are even
 *     constructed. The call in `main.ts` body is a second line of defense.
 *   - Synchronous on purpose: the preboot sequence at the top of `main.ts`
 *     runs before `app.whenReady()`. `dialog.showErrorBox` works pre-ready,
 *     so no lifecycle service or `await app.whenReady()` is needed here.
 *   - Rejection path uses `console` + `dialog` only — never the file logger —
 *     so a rejected launch writes nothing to the profile.
 *   - The dialog is bilingual (EN+ZH) by construction, so a locale-lookup
 *     failure can never leave a non-English user with English-only guidance.
 *     `isChinesePreferred()` only decides ordering, never content.
 *
 * Returns 'handled' when this launch must stop, 'skipped' otherwise.
 */
export function runOsSupportGate(): 'handled' | 'skipped' {
  if (process.platform !== 'win32') return 'skipped'
  let osRelease = ''
  try {
    osRelease = os.release()
  } catch (error) {
    console.warn('[OsSupportGate] Could not read OS release; skipping Windows version gate', error)
    return 'skipped'
  }
  if (isSupportedWindowsRelease(osRelease, process.platform)) return 'skipped'

  console.warn(`[OsSupportGate] Unsupported Windows release ${osRelease}; refusing to start`, {
    osRelease,
    minimum: MIN_SUPPORTED_WINDOWS_VERSION_LABEL
  })
  try {
    const chineseFirst = isChinesePreferred()
    const title = chineseFirst
      ? '当前 Windows 版本不受支持 / Windows version not supported'
      : 'Windows version not supported / 当前 Windows 版本不受支持'
    const osLabel = currentOsReleaseLabel(osRelease)
    const enDetail =
      `This device reports ${osLabel}. Cherry Studio requires ${MIN_SUPPORTED_WINDOWS_VERSION_LABEL} (64-bit) or later. ` +
      `Windows 7, 8, and 8.1 are not supported, including launches through third-party compatibility layers.\n\n` +
      `No data was changed. To continue, upgrade Windows or use a supported device. ` +
      `Past installers remain available on the releases page for reference only and receive no support or security updates.`
    const zhDetail =
      `当前系统报告为 ${osLabel}。Cherry Studio 需要 ${MIN_SUPPORTED_WINDOWS_VERSION_LABEL}（64 位）或更高版本。` +
      `Windows 7、8、8.1 均不受支持，通过第三方兼容层启动也不属于官方支持。\n\n` +
      `未对你的数据做任何更改。如需继续使用，请升级 Windows 或更换受支持的设备。` +
      `历史安装包仅可在发布页存档查看，不再提供支持与安全更新。`
    const detail = chineseFirst
      ? `${zhDetail}\n\n${enDetail}\n\n${WINDOWS_SUPPORT_RELEASES_URL}`
      : `${enDetail}\n\n${zhDetail}\n\n${WINDOWS_SUPPORT_RELEASES_URL}`
    dialog.showErrorBox(title, detail)
  } catch (error) {
    console.error('[OsSupportGate] Failed to show unsupported-OS dialog', error)
  }
  try {
    // eslint-disable-next-line lifecycle/no-direct-quit -- Application lifecycle is not constructed yet during preboot; app.quit is the only quit path.
    app.quit()
  } catch (error) {
    console.error('[OsSupportGate] Failed to quit app on unsupported OS', error)
  }
  process.exit(1)
  return 'handled'
}
