import { useLayoutEffect, useMemo, useRef } from 'react'

const layouts = new WeakMap<object, object>()

/** An addressed replacement keeps the page's positions. A server page has a fresh layout. */
export function historyPageLayout(items: object): object {
  let layout = layouts.get(items)
  if (!layout) {
    layout = {}
    layouts.set(items, layout)
  }
  return layout
}

export function keepHistoryPageLayout(previousItems: object, nextItems: object): void {
  layouts.set(nextItems, historyPageLayout(previousItems))
}

export function useHistoryPageProjection<Item, View>(
  pages: { items: Item[] }[],
  build: (pages: { items: Item[] }[]) => View,
  replace: (view: View, changes: Item[]) => View | undefined
): View {
  const committed = useRef<{ pages: typeof pages; build: typeof build; view: View }>(undefined)
  const view = useMemo(() => {
    const before = committed.current
    if (before?.build === build && before.pages.length === pages.length) {
      const changes: Item[] = []
      for (let i = 0; i < pages.length; i++) {
        const current = pages[i].items
        const previous = before.pages[i].items
        if (current === previous) continue
        if (historyPageLayout(current) !== historyPageLayout(previous)) return build(pages)
        for (let j = 0; j < current.length; j++) if (previous[j] !== current[j]) changes.push(current[j])
      }
      return changes.length ? (replace(before.view, changes) ?? build(pages)) : before.view
    }
    return build(pages)
  }, [pages, build, replace])
  useLayoutEffect(() => {
    committed.current = { pages, build, view }
  }, [pages, build, view])
  return view
}
