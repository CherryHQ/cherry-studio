import { type WindowOptions, type WindowType, type WindowTypeMetadata } from '@main/core/window/types'

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
  // Window configs are populated during migration — see migration plans in
  // ~/MyProjects/plans/cs-v2-window-manager-migration/
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
 * Merge window configuration.
 * Combines the type's default configuration with caller overrides,
 * performing a deep merge for webPreferences.
 *
 * @param type - The window type
 * @param overrides - Optional configuration overrides from the caller
 * @returns Merged window configuration
 */
export function mergeWindowConfig(type: WindowType, overrides?: Partial<WindowOptions>): WindowOptions {
  const metadata = getWindowTypeMetadata(type)
  const baseConfig = metadata.defaultConfig

  const webPreferences = {
    ...baseConfig.webPreferences,
    ...overrides?.webPreferences
  }

  return {
    ...baseConfig,
    ...overrides,
    webPreferences
  }
}
