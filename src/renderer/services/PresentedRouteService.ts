/** Same attribute as LoggerService. Read here so error presentation does not import that module. */
const WINDOW_SOURCE_META_NAME = 'logger-window-source'

class PresentedRouteService {
  private presentedRoute: string | undefined

  /** Remember the active in-app route. Memory history does not update `window.location`. */
  recordPresentedRoute(href: string | undefined): void {
    if (!href) return
    const path = href.split('?')[0]?.trim() ?? ''
    this.presentedRoute = path.length > 0 ? path.slice(0, 200) : undefined
  }

  readPresentedRoute(): string | undefined {
    return this.presentedRoute
  }

  readPresentedWindowSource(): string {
    if (typeof document === 'undefined') return ''
    const meta = document.querySelector(`meta[name="${WINDOW_SOURCE_META_NAME}"]`)
    return meta?.getAttribute('content')?.trim() ?? ''
  }
}

export const presentedRouteService = new PresentedRouteService()
