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

import osSupportMessages from './osSupportMessages.json'

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
 * Minimal mustache-style formatter for the preboot sidecar messages.
 * Kept local (instead of `@main/i18n`'s `t()`) so this earliest gate stays
 * dependency-free: `@main/i18n` pulls `@application` → `LoggerService`,
 * whose file transports touch the profile on import.
 */
function formatPrebootTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (name in params ? params[name] : match))
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
    // Bilingual by construction: both EN and ZH are always shown (order only
    // follows the system locale) so a locale-lookup failure can never leave a
    // non-English user with English-only guidance. Strings live in the JSON
    // sidecar — not in `@main/i18n` (pulls filesystem-touching imports and
    // needs `app.getLocale()` which is unsafe pre-`ready`) and not as CJK
    // literals here (rejected by `i18n:hardcoded:strict`).
    const title = chineseFirst
      ? `${osSupportMessages.titleZh} / ${osSupportMessages.titleEn}`
      : `${osSupportMessages.titleEn} / ${osSupportMessages.titleZh}`
    const osLabel = currentOsReleaseLabel(osRelease)
    const templateParams = { osLabel, minimum: MIN_SUPPORTED_WINDOWS_VERSION_LABEL }
    const enDetail = formatPrebootTemplate(osSupportMessages.detailEn, templateParams)
    const zhDetail = formatPrebootTemplate(osSupportMessages.detailZh, templateParams)
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
