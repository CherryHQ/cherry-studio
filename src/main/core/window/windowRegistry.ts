import { isDev, isLinux, isMac, isWin } from '@main/constant'
import { type WindowOptions, WindowType, type WindowTypeMetadata } from '@main/core/window/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/config/constant'

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
 *   windowOptions: { ...DEFAULT_WINDOW_CONFIG, minWidth: 350, minHeight: 400 },
 * }
 * ```
 */
export const WINDOW_TYPE_REGISTRY: Partial<Record<WindowType, WindowTypeMetadata>> = {
  // Main application window — singleton primary surface.
  // Managed by MainWindowService: dynamic options (window-state position/size, theme-driven
  // backgroundColor / titleBarOverlay / backgroundMaterial / frame / icon / zoomFactor) are
  // injected via wm.open({ options }). showMode 'manual' lets MainWindowService decide first
  // show in the ready-to-show handler (so tray-on-launch can suppress it).
  //
  // Intentionally NOT using `singletonConfig` here — MainWindowService's close handler
  // (see `setupWindowLifecycleEvents`) reads tray preferences at runtime, calls
  // `application.quit()` on Win/Linux without tray, guards on `isFullScreen()`, and
  // toggles `setMacShowInDockByType` for tray-mode transitions. None of this is
  // expressible via `retentionTime`, and forcing it through would regress Win/Linux
  // "close = quit" semantics. Eager warmup also clashes with the dynamic options +
  // state-preserving hide→show contract of Step A. See window-manager-warmup-mechanics.md
  // → Singleton Variant for the declarative alternative and its constraints.
  [WindowType.Main]: {
    type: WindowType.Main,
    lifecycle: 'singleton',
    htmlPath: 'index.html',
    // preload omitted → defaults to 'index.js' (full API preload).
    showMode: 'manual',
    windowOptions: {
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      autoHideMenuBar: true,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      platformOverrides: {
        mac: {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 13, y: 16 }
          // titleBarOverlay is theme-dependent → injected via args.options
        }
        // win: backgroundMaterial is runtime-computed (may be undefined) → args.options
        // linux: frame depends on `app.use_system_title_bar` preference, icon is nativeImage
        //        → both injected via args.options
      },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
        webviewTag: true,
        allowRunningInsecureContent: true,
        backgroundThrottling: false
        // zoomFactor depends on PreferenceService → injected via args.options
      }
    },
    behavior: {
      // Main window is the primary surface — always reflected in the macOS Dock.
      // WindowManager.updateDockVisibility uses this to drive Dock show/hide on
      // every show/hide/minimize/restore, replacing the manual app.dock?.show()
      // / app.dock?.hide() calls that used to live in the close handler.
      macShowInDock: true
    }
  },

  // Settings window — singleton popup surface for application settings.
  // The renderer consumes initData as the target /settings/* route, so open()
  // can focus an existing settings window and navigate it in-place.
  [WindowType.Settings]: {
    type: WindowType.Settings,
    lifecycle: 'singleton',
    htmlPath: 'settings.html',
    showMode: 'manual',
    windowOptions: {
      ...DEFAULT_WINDOW_CONFIG,
      width: 960,
      height: 680,
      minWidth: 760,
      minHeight: 520,
      autoHideMenuBar: true,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      platformOverrides: {
        mac: {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 13, y: 16 }
        }
      },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
        webviewTag: true
      }
    },
    behavior: {
      macShowInDock: true,
      closeToHide: true
    }
  },

  // Detached tab window — multi-instance, one per user-detached Tab.
  // Placed adjacent to Main because a SubWindow is logically a Main spin-off
  // (a Tab dragged out of Main becomes its own BrowserWindow here; drag back
  // to the Main tab bar re-attaches).
  // Managed by SubWindowService: dynamic options (per-tab title, theme-driven
  // titleBarOverlay / backgroundColor / darkTheme, Linux-only icon nativeImage,
  // optional initial x/y) are injected via wm.open({ options }). showMode
  // 'manual' lets SubWindowService decide show timing based on whether an
  // initial position was provided at Tab_Detach time (drop-at-cursor detach
  // wants the window at that position before show; no-position detach uses a
  // ready-to-show auto-show fallback). Init payload (tabId, url, title, type,
  // isPinned) flows via initData and useWindowInitData<SubWindowInitData>() in
  // the renderer.
  // NOTE on future evolution: if this ever changes to `lifecycle: 'pooled'`,
  // the Win/Linux content-bounds move path in SubWindowService (electron#27651)
  // requires `useContentSize: true` here — otherwise resetPooledWindowGeometry's
  // content-bounds branch is skipped and cached size drifts across reuse.
  [WindowType.SubWindow]: {
    type: WindowType.SubWindow,
    lifecycle: 'default',
    htmlPath: 'subWindow.html',
    // preload omitted → defaults to 'index.js' (full API preload).
    showMode: 'manual',
    windowOptions: {
      width: 800,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      autoHideMenuBar: true,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      platformOverrides: {
        mac: {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 8, y: 13 }
          // titleBarOverlay is theme-dependent → injected via args.options
        },
        win: {
          frame: false
          // backgroundColor is theme-dependent → injected via args.options (non-mac only)
        },
        linux: {
          frame: false
          // icon is a nativeImage (required for Wayland task switcher) → injected via args.options
        }
      },
      webPreferences: {
        sandbox: false,
        webSecurity: false,
        webviewTag: true,
        // REQUIRED: SubWindow hosts streaming LLM responses and WebSocket heartbeats;
        // Chromium's background-tab throttling would freeze the UI for seconds after
        // focus switches. Mirrors the Main window's choice above; do not remove.
        backgroundThrottling: false
      }
    }
    // NOTE: Fields intentionally NOT set here, injected per-call via wm.open({ options }):
    //   - title (per-tab dynamic)
    //   - titleBarOverlay / backgroundColor / darkTheme (theme snapshot at create time)
    //   - icon (Linux-only nativeImage; see SubWindowService.linuxIcon — mac/Windows omit)
    //   - x / y (only when Tab_Detach payload carries a drop position)
    // NOTE: setWindowOpenHandler + will-navigate are registered by WindowManager for
    // every BrowserWindow (see WindowManager.ts:1186-1201). SubWindow inherits both
    // automatically; do NOT attach another setWindowOpenHandler here or in the
    // service — Electron's API is single-slot and would overwrite WM's version.
  },

  // Quick Assistant window — singleton floating panel.
  // Managed by QuickAssistantService: stateKeeper bounds are injected via wm.create({ options }),
  // visibility is driven by showQuickAssistant() (cursor-follow, Windows opacity dance, macOS app.hide).
  [WindowType.QuickAssistant]: {
    type: WindowType.QuickAssistant,
    lifecycle: 'singleton',
    htmlPath: 'quickAssistant.html',
    // preload omitted → defaults to 'index.js' (full API preload).
    // QuickAssistantService.showQuickAssistant controls visibility; showMode: 'manual' also keeps
    // singleton reopen (wm.open) from accidentally re-showing the window before reposition runs.
    showMode: 'manual',
    windowOptions: {
      width: 550,
      height: 400,
      minWidth: 350,
      minHeight: 380,
      maxWidth: 1024,
      maxHeight: 768,
      frame: false,
      alwaysOnTop: true,
      useContentSize: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      platformOverrides: {
        mac: {
          type: 'panel',
          transparent: true,
          vibrancy: 'under-window',
          visualEffectState: 'followWindow'
        }
      },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
        webviewTag: true
      }
    },
    behavior: {
      // NOTE: QuickAssistant intentionally does NOT declare `hideOnBlur` here.
      // Its blur handler calls `hideQuickAssistant()`, which is platform-specific
      // business policy (Windows uses minimize + setOpacity(0) to avoid flicker;
      // macOS <26 additionally calls `app.hide()` to return focus to the previous
      // app). `behavior.hideOnBlur` would only invoke `window.hide()` — losing
      // both behaviors on those platforms. QuickAssistantService keeps its
      // blur handler and its internal `isPinnedQuickAssistant` flag.
      // `new BrowserWindow({ alwaysOnTop: true })` cannot accept a level — the
      // floating level is applied by applyWindowBehavior on create, and kept
      // across show cycles by the macReapplyAlwaysOnTop quirk below.
      alwaysOnTop: { level: 'floating' },
      // Quick window is visible across all workspaces and over fullscreen apps.
      visibleOnAllWorkspaces: { enabled: true, visibleOnFullScreen: true },
      // Quick window is a floating helper, not a primary surface — never touch the Dock.
      macShowInDock: false
    },
    quirks: {
      // Re-apply the floating level after every show/showInactive — macOS silently
      // demotes it across cycles. The actual level is read from `behavior.alwaysOnTop`.
      macReapplyAlwaysOnTop: true
    }
  },

  // Floating toolbar that appears near user text selections.
  // Managed by SelectionService: onActivate opens it (hidden), showToolbarAtPosition positions + shows.
  [WindowType.SelectionToolbar]: {
    type: WindowType.SelectionToolbar,
    lifecycle: 'singleton',
    htmlPath: 'selectionToolbar.html',
    // preload omitted → defaults to 'index.js'.
    // SelectionService controls visibility itself via showToolbarAtPosition/hideToolbar.
    // showMode: 'manual' also prevents wm.open() from re-showing an existing singleton unexpectedly.
    showMode: 'manual',
    windowOptions: {
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
    },
    behavior: {
      // Auto-hide on blur. SelectionService routes the mouse-key hook lifecycle
      // through `window.on('show'/'hide')` events so any hide path (this one
      // included) triggers the cleanup.
      hideOnBlur: true,
      alwaysOnTop: { level: 'screen-saver' },
      // Baseline declaration only. SelectionService.showToolbarAtPosition has a
      // per-show `!isSelf` branch that additionally sets
      // `skipTransformProcessType: true`; it MUST stay there, because one-shot
      // sinking that flag here would break the self / non-self distinction
      // (Cherry Studio as the frontmost app needs the flag off, others need it on).
      visibleOnAllWorkspaces: { enabled: true, visibleOnFullScreen: true },
      macShowInDock: false
    },
    // Declarative OS-specific workarounds — WindowManager monkey-patches instance methods
    // so that business calls to window.hide() / window.showInactive() / window.close()
    // transparently invoke the required pre/post hooks. See WindowQuirks in types.ts.
    quirks: {
      macRestoreFocusOnHide: true,
      macClearHoverOnHide: true,
      macReapplyAlwaysOnTop: true
    }
  },

  // Action result window — pooled for instant reuse.
  // Managed by SelectionService: processAction uses wm.open({ initData }) to hand each action to a renderer.
  [WindowType.SelectionAction]: {
    type: WindowType.SelectionAction,
    lifecycle: 'pooled',
    htmlPath: 'selectionAction.html',
    // preload omitted → defaults to 'index.js'.
    // SelectionService controls visibility itself via showActionWindow (computes bounds + fullscreen handling).
    showMode: 'manual',
    windowOptions: {
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
    },
    behavior: {
      // SelectionAction intentionally declares no hideOnBlur / alwaysOnTop.level /
      // visibleOnAllWorkspaces:
      //   - hideOnBlur is driven per-instance by the renderer's `isAutoClose && !isPinned`
      //     logic (see SelectionActionApp.tsx) — too case-specific for a WM default.
      //   - alwaysOnTop is toggled at runtime by pinActionWindow via wm.setAlwaysOnTop;
      //     passing no level lets Electron use its default ('floating' on macOS).
      //   - setVisibleOnAllWorkspaces's true/false options differ per call in the
      //     full-screen show sequence; see SelectionService.showActionWindow.
      macShowInDock: false
    },
    // Only restoreFocusOnHide applies — action windows show via the fullscreen-aware
    // sequence in SelectionService.showActionWindow (C-layer), not through window.show(),
    // so clearHover / reapplyAlwaysOnTop do not participate in its lifecycle.
    quirks: {
      macRestoreFocusOnHide: true
    },
    poolConfig: {
      // Producer axis: always keep one pre-warmed idle window. On every open(),
      // an async setImmediate replacement is scheduled so the next action recycles
      // instantly — the action window is user-facing and must not block on create.
      standbySize: 1,
      // Consumer axis: allow a small burst of concurrent action windows to be
      // recycled for reuse (triggered when a second action fires while the first
      // is still open). Beyond 3, close destroys.
      recycleMaxSize: 3,
      // Burst cleanup: after the pool grew above standbySize due to bursts,
      // shed one extra idle window per minute back down toward standbySize.
      decayInterval: 60,
      // Full idle release: after 5 minutes of no action, trim the recycle
      // buffer down to the standby window. standbySize is preserved as a
      // permanent availability commitment.
      inactivityTimeout: 300,
      warmup: 'eager'
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
 *   1. baseOptions (from registry `windowOptions`)
 *   2. baseOptions.platformOverrides[currentPlatform]
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
export function mergeWindowOptions(
  type: WindowType,
  overrides?: Partial<WindowOptions>
): Omit<WindowOptions, 'platformOverrides'> {
  const metadata = getWindowTypeMetadata(type)
  const baseOptions = metadata.windowOptions

  const basePlatform = pickPlatformOverride(baseOptions.platformOverrides)
  const overridePlatform = pickPlatformOverride(overrides?.platformOverrides)

  const webPreferences = {
    ...baseOptions.webPreferences,
    ...basePlatform?.webPreferences,
    ...overrides?.webPreferences,
    ...overridePlatform?.webPreferences
  }

  const merged: WindowOptions = {
    ...baseOptions,
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
