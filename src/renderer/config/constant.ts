export const DEFAULT_TEMPERATURE = 1.0
export const DEFAULT_CONTEXTCOUNT = 5
export const SYSTEM_PROMPT_THRESHOLD = 128
export const DEFAULT_KNOWLEDGE_DOCUMENT_COUNT = 6
export const DEFAULT_KNOWLEDGE_THRESHOLD = 0.0

export const platform = window.electron?.process?.platform
export const isMac = platform === 'darwin'
export const isWin = platform === 'win32' || platform === 'win64'
export const isLinux = platform === 'linux'
export const isDev = window.electron?.process?.env?.NODE_ENV === 'development'
export const isProd = window.electron?.process?.env?.NODE_ENV === 'production'

export const SILICON_CLIENT_ID = 'SFaJLLq0y6CAMoyDm81aMu'
export const PPIO_CLIENT_ID = '37d0828c96b34936a600b62c'
export const PPIO_APP_SECRET = import.meta.env.RENDERER_VITE_PPIO_APP_SECRET || ''
export const TOKENFLUX_HOST = 'https://tokenflux.ai'

// Messages loading configuration
export const INITIAL_MESSAGES_COUNT = 20
export const LOAD_MORE_COUNT = 20

export const DEFAULT_COLOR_PRIMARY = '#00b96b'
export const THEME_COLOR_PRESETS = [
  DEFAULT_COLOR_PRIMARY,
  '#EF4444', // Red
  '#F59E0B', // Amber
  '#3B82F6', // Blue
  '#8B5CF6' // Purple
]

export const MAX_CONTEXT_COUNT = 100
export const UNLIMITED_CONTEXT_COUNT = 100000

export const MAX_COLLAPSED_CODE_HEIGHT = 350

export const DEFAULT_STREAM_OPTIONS_INCLUDE_USAGE = true

export const API_SERVER_DEFAULTS = {
  HOST: '127.0.0.1',
  PORT: 23333
}

export const defaultByPassRules = 'localhost,127.0.0.1,::1'

/**
 * @deprecated v1 leftover. v2's preboot relocation copies the entire Electron
 * userData directory tree at startup (in `src/main/core/preboot/userDataLocation.ts`),
 * after the previous process has fully exited and no file is locked. The
 * distinction between "occupied" and "non-occupied" directories has no meaning
 * in v2 — the entire tree is opaque and copied as one unit.
 *
 * Still referenced only by `BasicDataSettings.tsx` (v1 in-process migration flow,
 * to be rewritten to the new BootConfig `temp.user_data_relocation` protocol).
 * This constant should be removed at the same time.
 */
export const occupiedDirs = ['logs', 'Network', 'Partitions/webview/Network']
