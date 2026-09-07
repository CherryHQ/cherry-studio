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
