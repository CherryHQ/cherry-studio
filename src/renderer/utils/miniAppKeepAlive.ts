import type { MiniApp } from '@shared/data/types/miniApp'

export const DEFAULT_MAX_KEEP_ALIVE_MINI_APPS = 10

export const MINI_APP_ROUTE_PREFIX = '/app/mini-app/'

export function miniAppIdFromTabUrl(url: string | undefined): string | null {
  if (!url?.startsWith(MINI_APP_ROUTE_PREFIX)) return null
  const id = url.slice(MINI_APP_ROUTE_PREFIX.length).split(/[/?#]/, 1)[0]
  return id || null
}

export function trimMiniAppKeepAlive(
  list: MiniApp[],
  targetSize: number,
  protectedAppIds: ReadonlySet<string> | null
): { keep: MiniApp[]; evicted: MiniApp[] } {
  let toDrop = list.length - targetSize
  if (toDrop <= 0 || protectedAppIds === null) return { keep: list, evicted: [] }

  const keep: MiniApp[] = []
  const evicted: MiniApp[] = []
  for (const app of list) {
    if (toDrop > 0 && !protectedAppIds.has(app.appId)) {
      evicted.push(app)
      toDrop--
    } else {
      keep.push(app)
    }
  }
  return { keep, evicted }
}
