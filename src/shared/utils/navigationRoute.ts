const LEGACY_MAIN_WINDOW_ROUTES = {
  '/agents': '/app/agents',
  '/knowledge': '/app/knowledge',
  '/paintings': '/app/paintings',
  '/translate': '/app/translate',
  '/files': '/app/files',
  '/notes': '/app/notes',
  '/apps': '/app/mini-app',
  '/code': '/app/code',
  '/launchpad': '/app/launchpad'
} as const

export function normalizeMainWindowRoute(path: string): string {
  for (const [legacyRoute, appRoute] of Object.entries(LEGACY_MAIN_WINDOW_ROUTES)) {
    const suffix = path.slice(legacyRoute.length)
    if (path === legacyRoute || suffix.startsWith('/') || suffix.startsWith('?') || suffix.startsWith('#')) {
      return `${appRoute}${suffix}`
    }
  }

  return path
}
