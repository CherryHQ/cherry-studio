function getNavigationPathSegments(value: string): string[] | undefined {
  if (!value.startsWith('/') || value.includes('?') || value.includes('#') || value.includes('\\')) return undefined

  const segments = value.slice(1).split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return undefined
  return segments
}

export function isAllowedNavigationPath(path: string, allowedRoutes: readonly string[]): boolean {
  const pathSegments = getNavigationPathSegments(path)
  if (!pathSegments) return false

  return allowedRoutes.some((route) => {
    const routeSegments = getNavigationPathSegments(route)
    if (!routeSegments) return false

    for (let index = 0; index < routeSegments.length; index++) {
      const routeSegment = routeSegments[index]
      if (routeSegment === '$') {
        return index === routeSegments.length - 1 && pathSegments.length > index
      }
      if (routeSegment.startsWith('$')) {
        if (!pathSegments[index]) return false
        continue
      }
      if (pathSegments[index] !== routeSegment) return false
    }

    return pathSegments.length === routeSegments.length
  })
}

/**
 * Routes that assistant output may open inside Cherry Studio.  Keep this list
 * shared with markdown linkification so route-shaped paths remain navigable on
 * every host platform (Windows paths otherwise require a drive or UNC prefix).
 */
const KNOWN_NAVIGATION_ROUTES = [
  '/app/chat',
  '/app/paintings',
  '/app/translate',
  '/app/files',
  '/app/notes',
  '/app/knowledge',
  '/app/mini-app',
  '/app/code',
  '/app/launchpad',
  '/app/agents',
  '/settings/general',
  '/settings/provider',
  '/settings/model',
  '/settings/local-models',
  '/settings/appearance',
  '/settings/notifications',
  '/settings/data',
  '/settings/mcp',
  '/settings/websearch',
  '/settings/api-gateway',
  '/settings/file-processing',
  '/settings/ocr',
  '/settings/shortcut',
  '/settings/quick-assistant',
  '/settings/selection-assistant',
  '/settings/about',
  '/settings/channels',
  '/settings/code-execution',
  '/settings/dependencies',
  '/settings/scheduled-tasks',
  '/settings/skills',
  '/settings/usage',
  '/settings/mcp/servers',
  '/settings/mcp/builtin',
  '/settings/mcp/marketplaces',
  '/settings/mcp/npx-search',
  '/settings/mcp/mcp-install',
  '/settings/mcp/settings',
  '/app/mini-app/$appId',
  '/app/paintings/$',
  '/settings/mcp/$',
  '/settings/mcp/settings/$serverId',
  '/settings/scheduled-tasks/$taskId'
] as const

export function isKnownNavigationPath(path: string): boolean {
  return isAllowedNavigationPath(path.split('?')[0], KNOWN_NAVIGATION_ROUTES)
}
