import { isDev, isLinux, isMac, isWin } from '@main/core/platform'
import { type WindowOptions, WindowType, type WindowTypeMetadata } from '@main/core/window/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/utils/window'

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
  // Managed by MainWindowService: dynamic options (theme-driven backgroundColor /
  // backgroundMaterial / frame / icon / zoomFactor) are injected via wm.open({ options }).
  // Window position/size/maximized are restored by WindowManager via `rememberBounds`
  // (no longer injected by the service). showMode 'manual' lets MainWindowService decide
  // first show in the ready-to-show handler (so tray-on-launch can suppress it).
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
    htmlPath: 'windows/main/index.html',
    // preload omitted → defaults to 'preload.js' (full API preload).
    showMode: 'manual',
    // Persist & restore position/size across launches (maximize re-applied by the service).
    rememberBounds: true,
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
          trafficLightPosition: { x: 13, y: 16 },
          // WCO height; consumed by renderer's env(titlebar-area-height)
          titleBarOverlay: { height: 42 }
        },
        win: {
          // Frameless + renderer-drawn WindowControls (mirrors SubWindow). Windows is
          // always frameless; backgroundMaterial stays runtime-computed → args.options.
          frame: false
        }
        // linux: frame honors `app.use_system_title_bar` preference, icon is nativeImage
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

  // Hidden one-shot print surface. PrintService owns loading generated paper HTML
  // and closes the window after print / PDF export.
  [WindowType.Print]: {
    type: WindowType.Print,
    lifecycle: 'default',
    htmlPath: '',
    preload: '',
    showMode: 'manual',
    windowOptions: {
      skipTaskbar: true,
      autoHideMenuBar: true,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: false
      }
    },
    behavior: {
      // Hidden helper window: do not bring the macOS Dock icon back in tray mode.
      macShowInDock: false
    }
  },

  // Hidden CDP browser surface for the built-in @cherry/browser MCP server.
  // CdpBrowserController owns content (tab BrowserViews + tab bar), show timing,
  // and close; the per-mode session partition (persist:default / private) is
  // injected per open via wm.open({ options: { webPreferences } }).
  [WindowType.McpBrowser]: {
    type: WindowType.McpBrowser,
    lifecycle: 'default',
    htmlPath: '',
    preload: '',
    showMode: 'manual',
    windowOptions: {
      width: 1200,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true
      },
      platformOverrides: {
        // macOS keeps the native frame with window-controls overlay; Windows and
        // Linux are frameless (the in-window tab bar renders its own controls).
        mac: {
          titleBarStyle: 'hidden',
          titleBarOverlay: { height: 42 }, // WCO height (macOS)
          trafficLightPosition: { x: 13, y: 13 }
        },
        win: { frame: false },
        linux: { frame: false }
      }
    },
    behavior: {
      // Hidden-by-default helper window: do not bring the macOS Dock icon back in tray mode.
      macShowInDock: false
    }
  },

  // Detached tab window — multi-instance, one per user-detached Tab.
  // Placed adjacent to Main because a SubWindow is logically a Main spin-off
  // (a Tab dragged out of Main becomes its own BrowserWindow here; drag back
  // to the Main tab bar re-attaches).
  // Managed by SubWindowService: dynamic options (per-tab title, theme-driven
  // backgroundColor / darkTheme, Linux-only icon nativeImage,
  // optional initial x/y) are injected via wm.open({ options }). showMode
  // 'manual' lets SubWindowService decide show timing based on whether an
  // initial position was provided at Tab_Detach time (drop-at-cursor detach
  // wants the window at that position before show; no-position detach uses a
  // ready-to-show auto-show fallback). Init payload (tabId, url, title, type,
  // isPinned) flows via initData and useWindowInitData<SubWindowInitData>() in
  // the renderer.
  [WindowType.SubWindow]: {
    type: WindowType.SubWindow,
    lifecycle: 'pooled',
    poolConfig: {
      // INVARIANT: this pool is destroy-on-close (standbySize:1 + warmup:'eager', and NO
      // recycleMaxSize). That is the *only* reason the SubWindow renderer is allowed to be
      // single-init: SubWindowAppShell opens its tab once (an `initialized` ref guard) and
      // ignores later WindowManager_Reused events. With no recycleMaxSize, close() always
      // destroys, so a window is never handed back carrying a *different* tab — every open()
      // either pops a pristine never-navigated standby or creates fresh. The renderer is NOT
      // reuse-safe. Do NOT add recycleMaxSize (or otherwise enable recycle) here without first
      // making the renderer re-initialize on window.reused; otherwise a recycled window would
      // keep displaying its previous tab.
      standbySize: 1,
      warmup: 'eager'
    },
    htmlPath: 'windows/subWindow/index.html',
    // preload omitted → defaults to 'preload.js' (full API preload).
    showMode: 'manual',
    windowOptions: {
      width: 800,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      useContentSize: true,
      autoHideMenuBar: true,
      transparent: false,
      // Load-bearing for SubWindowService.createWindow's show path: that path shows the window
      // unconditionally + immediately (no ready-to-show wait), relying on the hidden window having
      // already painted its renderer. This is Electron's default (true) — pinned explicitly so it
      // is never silently flipped to false (which would re-introduce the empty-shell first-paint
      // flash on reuse and the never-fires ready-to-show stuck-hidden failure mode).
      paintWhenInitiallyHidden: true,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      platformOverrides: {
        mac: {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 8, y: 13 },
          // WCO height; consumed by renderer's env(titlebar-area-height)
          titleBarOverlay: { height: 42 }
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
    },
    behavior: {
      // SubWindow must NOT contribute to the macOS Dock — a warm-created standby
      // instance (standbySize:1 + warmup:'eager') is always resident and hidden.
      // Without this flag, windowContributesToDock() returns true for it, so
      // updateDockVisibility()'s some() never resolves to hide, and the Dock icon
      // stays visible on close-to-tray / tray-on-launch (see issue #18186).
      macShowInDock: false
    }
    // NOTE: Fields intentionally NOT set here, injected per-call via wm.open({ options }):
    //   - title (per-tab dynamic)
    //   - backgroundColor / darkTheme (theme snapshot at create time)
    //   - icon (Linux-only nativeImage; see SubWindowService.linuxIcon — mac/Windows omit)
    //   - x / y (only when Tab_Detach payload carries a drop position)
    // NOTE: setWindowOpenHandler + will-navigate are registered by WindowManager for
    // every BrowserWindow (see WindowManager.ts:1186-1201). SubWindow inherits both
    // automatically; do NOT attach another setWindowOpenHandler here or in the
    // service — Electron's API is single-slot and would overwrite WM's version.
  },

  // Quick Assistant window — singleton floating panel.
  // Managed by QuickAssistantService: visibility is driven by showQuickAssistant()
  // (cursor-follow, Windows opacity dance, macOS app.hide). Window position/size are
  // restored by WindowManager via `rememberBounds`.
  [WindowType.QuickAssistant]: {
    type: WindowType.QuickAssistant,
    lifecycle: 'singleton',
    htmlPath: 'windows/quickAssistant/index.html',
    // preload omitted → defaults to 'preload.js' (full API preload).
    // QuickAssistantService.showQuickAssistant controls visibility; showMode: 'manual' also keeps
    // singleton reopen (wm.open) from accidentally re-showing the window before reposition runs.
    showMode: 'manual',
    // Persist & restore position/size across launches (never maximized — maximizable:false).
    rememberBounds: true,
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
      // across show cycles by the reapplyAlwaysOnTop quirk below.
      alwaysOnTop: { level: 'floating' },
      // Quick window is visible across all workspaces and over fullscreen apps.
      // `skipTransformProcessType: true` prevents TransformProcessType(UIElement)
      // during window creation on macOS (app deactivation + Dock icon loss);
      // MainWindowService's boot-time `app.dock?.show()` hack only masks that
      // transform on the startup path, not on runtime re-creates.
      visibleOnAllWorkspaces: { enabled: true, visibleOnFullScreen: true, skipTransformProcessType: true },
      // Quick window is a floating helper, not a primary surface — never touch the Dock.
      macShowInDock: false
    },
    quirks: {
      // Re-assert topmost after every show/showInactive — macOS silently demotes the
      // level across cycles, Windows lets later topmost windows stack above.
      // The actual level is read from `behavior.alwaysOnTop`.
      reapplyAlwaysOnTop: true
    }
  },

  // Floating toolbar that appears near user text selections.
  // Managed by SelectionService: onActivate opens it (hidden), showToolbarAtPosition positions + shows.
  [WindowType.SelectionToolbar]: {
    type: WindowType.SelectionToolbar,
    lifecycle: 'singleton',
    htmlPath: 'windows/selection/toolbar/index.html',
    // preload omitted → defaults to 'preload.js'.
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
      // The toolbar is a transparent, frameless pill that draws its own rounded
      // background in CSS. Newer macOS enlarged
      // the system window-corner radius, so with the OS rounding on, the window mask
      // overrides the pill's own corners — the top (only 2px from the window edge)
      // takes the larger OS radius while the bottom keeps the CSS radius, producing a
      // visible top/bottom mismatch. Disable OS rounding and let the pill define its
      // own shape. NOTE: Electron defaults roundedCorners to true, so this must be an
      // explicit false — omitting it would fall back to the OS rounding.
      roundedCorners: false,

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
      // Baseline declaration, re-applied on every (re-)create. `skipTransformProcessType`
      // MUST be true: without it, Electron runs TransformProcessType(UIElement) inside
      // this call on macOS, which deactivates the whole app (every window drops behind
      // the frontmost app) and removes the Dock icon — user-visible each time the
      // selection assistant is toggled on (the toolbar is destroyed on disable and
      // re-created on enable). SelectionService.showToolbarAtPosition still has its
      // per-show `!isSelf` branch re-applying the same flags; it MUST stay there,
      // because self-app shows must skip that call entirely or the active text
      // selection gets canceled.
      visibleOnAllWorkspaces: { enabled: true, visibleOnFullScreen: true, skipTransformProcessType: true },
      macShowInDock: false
    },
    // Declarative OS-specific workarounds — WindowManager monkey-patches instance methods
    // so that business calls to window.hide() / window.showInactive() / window.close()
    // transparently invoke the required pre/post hooks. See WindowQuirks in types.ts.
    quirks: {
      macRestoreFocusOnHide: true,
      macClearHoverOnHide: true,
      reapplyAlwaysOnTop: true
    }
  },

  // Action result window — pooled for instant reuse.
  // Managed by SelectionService: processAction uses wm.open({ initData }) to hand each action to a renderer.
  [WindowType.SelectionAction]: {
    type: WindowType.SelectionAction,
    lifecycle: 'pooled',
    htmlPath: 'windows/selection/action/index.html',
    // preload omitted → defaults to 'preload.js'.
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
          trafficLightPosition: { x: 12, y: 11 } // [macOS]
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
      //     logic (see ActionWindow.tsx) — too case-specific for a WM default.
      //   - alwaysOnTop is toggled at runtime by the `selection.pin_action_window`
      //     IpcApi handler via wm.behavior.setAlwaysOnTop; passing no level lets
      //     Electron use its default ('floating' on macOS).
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
  },

  // Full-display capture overlay — one instance per display, opened and dismissed together.
  // Pooled because a session creates N windows at once and users re-trigger it repeatedly.
  [WindowType.Screenshot]: {
    type: WindowType.Screenshot,
    lifecycle: 'pooled',
    htmlPath: 'windows/screenshot/index.html',
    // preload omitted → defaults to 'preload.js'. OCR runs in the main process,
    // so this window needs no nodeIntegration and keeps contextIsolation on.

    // ScreenshotOverlayService owns visibility: overlays are shown at opacity 0 and revealed only
    // once content has painted, so the OS window-open animation never shows over the frozen image.
    showMode: 'manual',
    windowOptions: {
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      // frame:false hides the buttons, but OS shortcuts (e.g. Cmd+M) can still fire.
      minimizable: false,
      maximizable: false,
      // Must be false on every platform: on Linux `true` keeps the overlay off the
      // top layer; on macOS it conflicts with the panel window type.
      fullscreen: false,
      // macOS crashes when a transparent overlay window is fullscreenable.
      fullscreenable: false,
      hasShadow: false,
      // Removes WS_THICKFRAME on Windows, killing the frameless show/hide animation.
      // No effect elsewhere; safe because shadow and resizing are already off.
      thickFrame: false,
      backgroundColor: '#00000000',
      focusable: true,
      // Make the content area match the display exactly, excluding any frame.
      useContentSize: true,
      autoHideMenuBar: true,
      // macOS: let the first click start a selection instead of only focusing.
      acceptFirstMouse: true,
      enableLargerThanScreen: true,
      platformOverrides: {
        mac: {
          // Floating panel that does not steal app activation.
          type: 'panel',
          // OS corner rounding would reveal the desktop at the overlay's corners.
          roundedCorners: false
        },
        win: {
          // Toolbar windows stay above normal windows.
          type: 'toolbar'
        }
        // Linux: no `type` at all — any value breaks focus events on some desktop
        // environments (KDE, i3).
      },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        // Required by every window on the shared preload: that bundle is code-split, and a
        // sandboxed preload cannot require its chunks — it dies with "module not found".
        sandbox: false,
        devTools: true,
        // Declared on WebPreferences, NOT at the constructor-options root. Off because a red
        // squiggle under the text-annotation input would be drawn into the annotation layer.
        spellcheck: false
      }
    },
    behavior: {
      // screen-saver level puts the overlay above the Dock and menu bar.
      alwaysOnTop: { level: 'screen-saver' },
      // visibleOnFullScreen lets the overlay cover macOS fullscreen apps; skipTransformProcessType
      // stops the process-type change that would flash the Dock icon and disturb focus.
      visibleOnAllWorkspaces: { enabled: true, visibleOnFullScreen: true, skipTransformProcessType: true },
      macShowInDock: false
    },
    quirks: {
      // ScreenshotOverlayService hides and re-shows every overlay so the macOS save panel can sit
      // above them; macOS then drops the level and Windows loses topmost, returning it below the Dock.
      reapplyAlwaysOnTop: true
    },
    poolConfig: {
      // No standby: capture sessions are user-initiated and bursty, and a permanently
      // warm overlay would hold a transparent window per display for nothing.
      standbySize: 0,
      // A capture session opens one window per display; 4 covers realistic setups.
      recycleMaxSize: 4,
      // No decay: a display count does not drift, so shedding one window a minute only
      // guarantees that the next capture is cold again. The buffer is kept whole and
      // released whole, 10 minutes after the last capture.
      decayInterval: 0,
      inactivityTimeout: 600,
      warmup: 'lazy'
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
