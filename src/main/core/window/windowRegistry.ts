import { isDev, isLinux, isMac, isWin } from '@main/constant'
import { type WindowOptions, WindowType, type WindowTypeMetadata } from '@main/core/window/types'

/**
 * Default window configuration.
 * Base configuration applied to all windows unless overridden by the type-specific config.
 */
export const DEFAULT_WINDOW_CONFIG: WindowOptions = {
  width: 1100,
  height: 720,
  autoHideMenuBar: true,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true
  }
}

/**
 * Window type registry.
 * Maps each window type to its metadata and default configuration.
 *
 * Uses `Partial<Record<...>>` to support incremental migration: window types
 * are added here one-by-one as they are migrated to the WindowManager.
 *
 * @example Adding a new window type during migration:
 * ```typescript
 * WINDOW_TYPE_REGISTRY[WindowType.Main] = {
 *   type: WindowType.Main,
 *   lifecycle: 'singleton',
 *   htmlPath: 'index.html',
 *   preload: 'standard',
 *   defaultConfig: { ...DEFAULT_WINDOW_CONFIG, minWidth: 350, minHeight: 400 },
 * }
 * ```
 */
export const WINDOW_TYPE_REGISTRY: Partial<Record<WindowType, WindowTypeMetadata>> = {
  // Floating toolbar that appears near user text selections.
  // Managed by SelectionService: onActivate opens it (hidden), showToolbarAtPosition positions + shows.
  [WindowType.SelectionToolbar]: {
    type: WindowType.SelectionToolbar,
    lifecycle: 'singleton',
    htmlPath: 'selectionToolbar.html',
    preload: 'standard',
    // SelectionService controls visibility itself via showToolbarAtPosition/hideToolbar.
    // show: false also prevents wm.open() from re-showing an existing singleton unexpectedly.
    show: false,
    showInDock: false,
    // Declarative OS-specific workarounds — WindowManager monkey-patches instance methods
    // so that business calls to window.hide() / window.showInactive() / window.close()
    // transparently invoke the required pre/post hooks. See WindowQuirks in types.ts.
    quirks: {
      macRestoreFocusOnHide: true,
      macClearHoverOnHide: true,
      macReapplyAlwaysOnTop: 'screen-saver'
    },
    defaultConfig: {
      width: 350,
      height: 43,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false, // [macOS] must be false
      movable: true,
      hasShadow: false,
      thickFrame: false,
      roundedCorners: true,

      // Platform specific settings
      //   [macOS] DO NOT set focusable to false — it causes other windows to bring to front together.
      //           type 'panel' conflicts with some settings and triggers the warning
      //           `NSWindow does not support nonactivating panel styleMask 0x80`,
      //           but it still works correctly on fullscreen apps, so we keep it.
      //   [Windows/Linux X11] focusable: false prevents toolbar from stealing focus.
      //           On Linux X11 this also makes the window stop interacting with WM (stays on top).
      //   [Linux Wayland] focusable: true enables blur events for outside-click hiding.
      //           With focusable: false on XWayland, blur never fires and there is no reliable
      //           way to detect outside clicks (selection-hook coordinates use a different
      //           coordinate space than Electron's getBounds on Wayland).
      // The real focusable value on Wayland is set at runtime by SelectionService
      // via setFocusable(isLinuxWaylandDisplay) inside the onWindowCreated callback,
      // because the Wayland detection is only available after the native module loads.
      platformOverrides: {
        mac: {
          type: 'panel',
          hiddenInMissionControl: true, // [macOS only]
          acceptFirstMouse: true // [macOS only]
        },
        win: {
          type: 'toolbar',
          focusable: false
        },
        linux: {
          // focusable is left to SelectionService to set at runtime
          // (Wayland → true, X11 → false) once the native module reports the display protocol.
          type: 'toolbar'
        }
      },

      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        devTools: isDev
      }
    }
  },

  // Action result window — pooled for instant reuse.
  // Managed by SelectionService: processAction uses wm.open({ initData }) to hand each action to a renderer.
  [WindowType.SelectionAction]: {
    type: WindowType.SelectionAction,
    lifecycle: 'pooled',
    htmlPath: 'selectionAction.html',
    preload: 'standard',
    // SelectionService controls visibility itself via showActionWindow (computes bounds + fullscreen handling).
    show: false,
    showInDock: false,
    // Only restoreFocusOnHide applies — action windows show via the fullscreen-aware
    // sequence in SelectionService.showActionWindow (C-layer), not through window.show(),
    // so clearHover / reapplyAlwaysOnTop do not participate in its lifecycle.
    quirks: {
      macRestoreFocusOnHide: true
    },
    poolConfig: {
      // Keep at least one mounted idle window at all times so the next user
      // action recycles instantly, matching the legacy pre-WindowManager
      // behavior where SelectionService manually preloaded a single action
      // window and immediately recreated one after each use.
      minIdle: 1,
      initialSize: 1,
      // Allow a small burst for concurrent actions (legacy code hit this too
      // when a second action fired while the first was still open).
      maxSize: 3,
      warmup: 'eager',
      // Never decay below minIdle and never idle-timeout to zero: the whole
      // point of this pool is to keep the renderer process hot between
      // actions. Explicit suspend/resume is handled by SelectionService on
      // activate/deactivate.
      decayInterval: 0,
      idleTimeout: 0
    },
    defaultConfig: {
      width: 500,
      height: 400,
      minWidth: 300,
      minHeight: 200,
      frame: false,
      transparent: true,
      autoHideMenuBar: true,
      hasShadow: false,
      thickFrame: false,
      platformOverrides: {
        mac: {
          titleBarStyle: 'hidden', // [macOS]
          trafficLightPosition: { x: 12, y: 9 } // [macOS]
        }
      },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        devTools: true
      }
    }
  }
}

/**
 * Get window type metadata.
 * @param type - The window type to look up
 * @returns The metadata for the specified window type
 * @throws Error if the window type is not registered
 */
export function getWindowTypeMetadata(type: WindowType): WindowTypeMetadata {
  const metadata = WINDOW_TYPE_REGISTRY[type]
  if (!metadata) {
    throw new Error(
      `WindowType '${type}' is not registered in WINDOW_TYPE_REGISTRY. ` +
        `Register it before calling open() or create().`
    )
  }
  return metadata
}

/**
 * Pick the `platformOverrides` branch matching the current runtime.
 * Returns `undefined` when no override is configured for the current platform.
 */
function pickPlatformOverride(
  overrides: WindowOptions['platformOverrides']
): Partial<Omit<WindowOptions, 'platformOverrides'>> | undefined {
  if (!overrides) return undefined
  if (isMac) return overrides.mac
  if (isWin) return overrides.win
  if (isLinux) return overrides.linux
  return undefined
}

/**
 * Merge window configuration.
 *
 * Order of precedence (later wins):
 *   1. baseConfig (from registry `defaultConfig`)
 *   2. baseConfig.platformOverrides[currentPlatform]
 *   3. caller-provided `overrides`
 *   4. caller-provided `overrides.platformOverrides[currentPlatform]`
 *
 * `webPreferences` is deep-merged in the same order.
 * The `platformOverrides` field is stripped from the returned config so it never
 * leaks into `new BrowserWindow(...)` (Electron would silently ignore it, but keeping
 * the return type clean avoids confusion for consumers and future refactors).
 *
 * @param type - The window type
 * @param overrides - Optional configuration overrides from the caller
 * @returns Merged window configuration, guaranteed to omit `platformOverrides`.
 */
export function mergeWindowConfig(
  type: WindowType,
  overrides?: Partial<WindowOptions>
): Omit<WindowOptions, 'platformOverrides'> {
  const metadata = getWindowTypeMetadata(type)
  const baseConfig = metadata.defaultConfig

  const basePlatform = pickPlatformOverride(baseConfig.platformOverrides)
  const overridePlatform = pickPlatformOverride(overrides?.platformOverrides)

  const webPreferences = {
    ...baseConfig.webPreferences,
    ...basePlatform?.webPreferences,
    ...overrides?.webPreferences,
    ...overridePlatform?.webPreferences
  }

  const merged: WindowOptions = {
    ...baseConfig,
    ...basePlatform,
    ...overrides,
    ...overridePlatform,
    webPreferences
  }

  // Strip platformOverrides from the returned object so it never leaks to `new BrowserWindow(...)`.
  const rest: Record<string, unknown> = { ...merged }
  delete rest.platformOverrides
  return rest as Omit<WindowOptions, 'platformOverrides'>
}
