import type { PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

/**
 * Device/platform-local preference keys reset to target defaults while staging a
 * restore (docs/references/backup/README.md §3.1). The Preference schema carries
 * no device-binding metadata, so this list is BACKUP-OWNED and must be audited by
 * hand — every entry below therefore cites the reader that proves the value is
 * meaningless, broken, or unsafe on a different machine.
 *
 * ## The bar for membership
 *
 * A key is listed only when a reader proves the stored value NAMES A RESOURCE OR
 * REGISTRATION THAT EXISTS ONLY ON THE PRODUCER DEVICE — an absolute path, a
 * listening socket, an OS registration, a locally installed program, a
 * machine identity — or when restoring it initiates an automatic side effect the
 * target user never confirmed. Ordinary user preferences (language, theme, fonts,
 * model defaults, layout, notification toggles) are PRESERVED; a preference that
 * merely *feels* machine-flavoured is not enough. Keys whose reader already
 * self-heals per platform are preserved too, because resetting them buys no
 * safety and loses user intent — see {@link PRESERVED_AFTER_REVIEW}.
 *
 * ## Reset mechanism
 *
 * "Reset to target default" is implemented by DELETING the row from the
 * `preference` table, not by writing a default value: `PreferenceService.get`
 * resolves a missing key through `DefaultPreferences.default`
 * (src/main/data/PreferenceService.ts:352), so a deleted row automatically picks
 * up the target build's current default instead of freezing the value the
 * producer's build happened to ship.
 *
 * Typed against {@link PreferenceKeyType}, so a key renamed in the
 * (auto-generated) preference schema breaks this file at typecheck rather than
 * silently disabling a reset.
 */
export const PREFERENCE_RESET_KEYS = [
  // -- Machine / installation identity --
  // Per-installation analytics client id: `getClientId` persists a generated UUID
  // (src/main/utils/systemInfo.ts:100-109) and AnalyticsService sends it as the
  // `Client-Id` header (src/main/services/AnalyticsService.ts:61). Restoring it
  // would make two machines report as one client. Self-healing: an invalid value
  // is regenerated.
  'app.user.id',

  // -- OS startup registration (§2.3 excludes "target-device startup choices") --
  // Login-item / autostart registration: `app.setLoginItemSettings({ openAtLogin })`
  // and the Linux `.desktop` autostart file (src/main/services/AppService.ts:11-15).
  // A restored `true` would make the app launch on boot on a machine whose user
  // never asked for it. (The renderer path that applies it is currently dead —
  // only the settings switch reads the key,
  // src/renderer/pages/settings/SystemSettings/SystemSettings.tsx:119 — but the
  // preference IS the registration intent, so the reset must not wait for that
  // bug to be fixed.)
  'app.launch_on_boot',
  // Starts the main window HIDDEN in the tray (src/main/services/MainWindowService.ts:107,
  // suppressing `show()` at :255,:270). Right after a restore relaunch this looks
  // like the app failed to start, and on a Linux desktop without a tray there is
  // nothing to restore the window from.
  'app.tray.on_launch',

  // -- Platform-scoped window state with no target-platform repair UI --
  // Sets the BrowserWindow `frame:` unconditionally
  // (src/main/services/MainWindowService.ts:195) and hides the in-app window
  // controls (src/renderer/components/WindowControls/WindowControls.tsx:57), yet
  // the setting is rendered ONLY on Linux
  // (src/renderer/pages/settings/AppearanceSettings/AppearanceSettings.tsx:127).
  // A Linux profile restored on macOS/Windows therefore produces a window the
  // user cannot repair from the UI.
  'app.use_system_title_bar',

  // -- Network interception --
  // These three configure the Electron session proxy
  // (src/main/services/ProxyService.ts:105-107) and the binary-download
  // environment (src/main/services/BinaryManager.ts:297). A custom proxy URL is
  // typically a machine-local endpoint (`http://127.0.0.1:<port>`), so restoring
  // it breaks all traffic on the target; worse, an archive that names a REMOTE
  // proxy would silently route the target user's traffic through it, which is
  // exactly the network side effect §3.1 forbids an archive from arming.
  'app.proxy.mode',
  'app.proxy.url',
  'app.proxy.bypass_rules',

  // -- Producer-local filesystem selections (§3.1 "reset selecting preferences") --
  // Retained version-1 local backup directory; no version-2 runtime consumes it.
  'data.backup.local.dir',
  // When set, exports are written straight into this absolute directory instead
  // of prompting (src/renderer/services/ExportService.ts:362,403,446), so a
  // producer path would silently misfile the target user's exports.
  'data.export.markdown.path',
  // Absolute notes root. Empty (the default) makes the renderer fall back to the
  // managed root `application.getPath('feature.notes.data')`
  // (src/main/ipc/handlers/app.ts:20 → src/renderer/services/NotesService.ts:122),
  // which is the target-correct location; a producer path is exported into
  // blindly (src/renderer/hooks/useNotesSettings.ts:18 and its consumers, e.g.
  // src/renderer/components/chat/messages/hooks/useMessageExportActions.ts:39).
  'feature.notes.path',
  // Names a vault inside the target machine's Obsidian installation; used to
  // build the export `obsidian://` URI
  // (src/renderer/components/ObsidianExportDialog.tsx:180). Third-party local
  // install state — `external.*` by the §4 scope rules.
  'data.integration.obsidian.default_vault',

  // -- Platform-bound local processors --
  // `assertProcessorUsable` THROWS "File processor <id> is not available on this
  // platform" (src/main/features/fileProcessing/config/resolveProcessorConfig.ts:44-51),
  // and the file's own comment at :66-74 documents this exact cross-OS restore
  // hazard. Values point at platform-only or locally downloaded engines: `system`
  // (macOS Vision / Windows OCR), `tesseract`, or `local-paddleocr` — the last
  // written only after a local model download on this machine
  // (src/main/services/localModel/LocalOcrDownloadService.ts:207).
  'feature.file_processing.default_image_to_text',
  'feature.file_processing.default_document_to_markdown',

  // -- Locally installed programs --
  // Inventory of binaries installed on THIS machine (src/main/services/BinaryManager.ts:871,
  // written at :878,:885,:1773). Restoring it claims tools are installed that are not.
  'feature.binary.tools',
  // Requires the macOS accessibility grant — throws unless
  // `isTrustedAccessibilityClient` (src/main/services/selection/SelectionService.ts:191-196)
  // — and already self-heals to `false` when the native hook cannot load (:187).
  // Listed because it is an OS-permission-bound capability, not merely a toggle.
  'feature.selection.enabled',
  // Matched against OS process names (`selectionData.programName`,
  // src/main/services/selection/SelectionService.ts:821-822) and pushed into the
  // native hook (:429-431). The names are per-platform (`foo.exe` vs an app
  // bundle name), so a restored list silently matches nothing.
  'feature.selection.filter_list',
  // Whitelist/blacklist mode for the list above (:423-425); meaningless once the
  // list is reset, so the pair resets together.
  'feature.selection.filter_mode',

  // -- Local listening socket + its secret --
  // `shouldAutoStart` opens a local HTTP listener on boot
  // (src/main/features/apiGateway/ApiGatewayService.ts:172-176 →
  // src/main/features/apiGateway/server.ts:42,50). An archive must not make the
  // target device start serving.
  'feature.api_gateway.enabled',
  // Self-generating bearer secret (`ensureValidApiKey`,
  // src/main/features/apiGateway/ApiGatewayService.ts:159-166) checked at
  // src/main/features/apiGateway/middleware/auth.ts:36. Archives carry plaintext
  // credentials (§5.1.1) and get copied around, so a restored key would let
  // anyone holding the archive authenticate against the target's gateway.
  // Deleting it regenerates a fresh one.
  'feature.api_gateway.api_key',

  // -- Legacy remote-sync preferences --
  // These version-1 preferences remain for upgrade compatibility but have no
  // version-2 runtime consumer. Reset them so restored archives cannot retain
  // a producer's formerly armed sync configuration.
  'data.backup.local.auto_sync',
  'data.backup.nutstore.auto_sync',
  'data.backup.s3.auto_sync',
  'data.backup.webdav.auto_sync'
] as const satisfies readonly PreferenceKeyType[]

const RESET_KEY_SET: ReadonlySet<string> = new Set(PREFERENCE_RESET_KEYS)

/** Whether a stored `preference` row must be dropped so the target default applies. */
export function isPreferenceResetKey(key: string): boolean {
  return RESET_KEY_SET.has(key)
}

/**
 * Keys reviewed for device-binding and deliberately PRESERVED, with the reason.
 * Recorded so the negative decisions are as auditable as the positive ones: a
 * future reviewer can see these were considered, not overlooked.
 *
 * Referenced by the policy tests, which assert none of them leaked into
 * {@link PREFERENCE_RESET_KEYS}.
 */
export const PRESERVED_AFTER_REVIEW: Readonly<Record<string, string>> = Object.freeze({
  // Ordinary display preference (like font size); nothing about it is bound to a
  // particular monitor, and the reader clamps it (src/main/utils/zoom.ts:11).
  'app.zoom_factor': 'user display preference, not device state',
  // Platform-scoped BUT the reader is already platform-gated
  // (src/renderer/hooks/useMacTransparentWindow.ts:5-7 requires `isMac`), so a
  // foreign value is inert rather than broken.
  'ui.window_style': 'reader is platform-gated, foreign value is inert',
  // Hide-to-tray is gated on the tray actually existing
  // (src/main/services/MainWindowService.ts:398), so these self-heal on a desktop
  // without a tray.
  'app.tray.enabled': 'self-heals when no tray exists',
  'app.tray.on_close': 'self-heals when no tray exists',
  // Accelerator collisions with other apps on the target machine are already
  // handled: `markRegistrationConflict` records the clash instead of failing
  // (src/main/services/ShortcutService.ts:166,204). All 19 `shortcut.*` keys are
  // ordinary user preferences by this evidence.
  'shortcut.app.window.show': 'OS-registration conflicts are handled, not fatal',
  'shortcut.quick_assistant.toggle': 'OS-registration conflicts are handled, not fatal',
  'shortcut.selection.capture_text': 'OS-registration conflicts are handled, not fatal',
  'shortcut.selection.toggle': 'OS-registration conflicts are handled, not fatal',
  // Chosen port/bind address are user config and inert while
  // `feature.api_gateway.enabled` is reset; a port clash surfaces as a visible
  // `EADDRINUSE` (src/main/features/apiGateway/server.ts:59-61).
  'feature.api_gateway.host': 'inert while the gateway is disabled',
  'feature.api_gateway.port': 'inert while the gateway is disabled',
  // Started only by explicit user action in the renderer
  // (src/renderer/pages/code/hooks/useOpenClawGatewayController.ts:48), never on boot.
  'feature.openclaw.gateway_port': 'no automatic start path',
  // Install-scoped user intent about update feeds, not machine state; the default
  // for auto-download is already `true`.
  'app.dist.auto_update.enabled': 'user intent about updates, not device state',
  'app.dist.test_plan.enabled': 'user intent about updates, not device state',
  'app.dist.test_plan.channel': 'user intent about updates, not device state',
  // Language codes are portable; only dictionary availability is platform-dependent
  // and Chromium degrades rather than failing (src/main/services/MainWindowService.ts:228).
  'app.spell_check.enabled': 'portable, degrades gracefully',
  'app.spell_check.languages': 'portable, degrades gracefully',
  // Portable user intent — a power-save blocker is requested at runtime
  // (src/main/core/power/PowerService.ts:295).
  'app.power.prevent_sleep_when_busy': 'portable user intent',
  // Remote/account configuration, not device state. Backup v2 is a whole-profile
  // restore and explicitly carries plaintext credentials (§5.1.1). These values
  // remain inert because every automatic sync flag is reset; retaining them lets
  // the user explicitly re-enable a destination without reconstructing it.
  'data.backup.webdav.host': 'remote destination config; only its automation is reset',
  'data.backup.webdav.pass': 'remote credential; preserved but automatic sync is reset',
  'data.backup.nutstore.token': 'remote credential; preserved but automatic sync is reset',
  'data.backup.s3.endpoint': 'remote destination config; only its automation is reset',
  'data.backup.s3.access_key_id': 'remote credential; preserved but automatic sync is reset',
  'data.backup.s3.secret_access_key': 'remote credential; preserved but automatic sync is reset',
  // Third-party export credentials are consumed only by an explicit export
  // action. Preserving them performs no I/O during restore or startup.
  'data.integration.joplin.token': 'remote credential used only by an explicit export action',
  'data.integration.notion.api_key': 'remote credential used only by an explicit export action',
  'data.integration.siyuan.token': 'remote credential used only by an explicit export action',
  'data.integration.yuque.token': 'remote credential used only by an explicit export action',
  // Third-party service endpoints that may legitimately be remote; no reader
  // proves a device binding.
  'data.integration.siyuan.api_url': 'may be remote; no device-binding evidence',
  'data.integration.siyuan.root_path': 'path inside the SiYuan service, may be remote',
  'data.integration.joplin.url': 'may be remote; no device-binding evidence',
  // Per-processor API keys/hosts. A `127.0.0.1` apiHost is possible but this is
  // provider configuration, and no reader proves device binding.
  'feature.file_processing.overrides': 'provider config; no device-binding evidence',
  // Geo/locale filter the user selects; default `auto`.
  'feature.mini_app.region': 'user-selectable locale filter',
  // Reads the OS clipboard on window open, but that is the feature's purpose and
  // is user intent, not device state.
  'feature.quick_assistant.read_clipboard_at_startup': 'user intent, not device state'
})

/**
 * `feature.code_cli.configs` is PARTIALLY device-bound, so it gets surgery
 * instead of a whole-key reset: each tool's state mixes portable provider
 * configuration with two device-local fields. Blanket-resetting the key would
 * throw away every CLI provider and model the user configured.
 */
export const CODE_CLI_CONFIGS_KEY = 'feature.code_cli.configs' satisfies PreferenceKeyType

/**
 * The device-local fields inside one `CodeCliToolState`
 * (src/shared/data/preference/preferenceTypes.ts:296-308):
 * - `directory` — absolute working directory the CLI is launched in
 *   (src/renderer/hooks/useCodeCli.ts:57, consumed at
 *   src/renderer/pages/code/hooks/useLaunchDialogController.ts:107);
 * - `terminal` — an id from `code_cli.get_available_terminals`, i.e. a terminal
 *   application installed on THIS machine (src/renderer/hooks/useCodeCli.ts:56).
 *
 * Everything else (`providers`, `current`, `sortIndex`, per-provider `config`) is
 * portable and preserved.
 */
const CODE_CLI_DEVICE_LOCAL_FIELDS = ['directory', 'terminal'] as const

export type CodeCliConfigsReset =
  /** The stored value is not an object map: nothing is salvageable, drop the row so the `{}` default applies. */
  | { readonly kind: 'delete' }
  /** Rewrite the row with the device-local fields stripped from the named tools. */
  | {
      readonly kind: 'rewrite'
      readonly value: Readonly<Record<string, unknown>>
      readonly strippedTools: readonly string[]
    }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Strip the device-local fields from every tool entry. Known-field work only: a
 * tool entry that is not an object is passed through untouched rather than
 * guessed at, and an unrecognized tool id is still processed because the
 * device-local FIELD names — not the tool ids — are what this policy knows.
 */
export function sanitizeCodeCliConfigs(raw: unknown): CodeCliConfigsReset {
  if (!isPlainObject(raw)) return { kind: 'delete' }

  const value: Record<string, unknown> = {}
  const strippedTools: string[] = []
  for (const [toolId, toolState] of Object.entries(raw)) {
    if (!isPlainObject(toolState)) {
      value[toolId] = toolState
      continue
    }
    const next = { ...toolState }
    let stripped = false
    for (const field of CODE_CLI_DEVICE_LOCAL_FIELDS) {
      if (field in next) {
        delete next[field]
        stripped = true
      }
    }
    if (stripped) strippedTools.push(toolId)
    value[toolId] = next
  }
  return { kind: 'rewrite', value, strippedTools }
}
