export type TranslateRouteSearch = {
  tabSession?: string
}

export function parseTranslateRouteSearch(search: Record<string, unknown>): TranslateRouteSearch {
  const tabSession = typeof search.tabSession === 'string' && search.tabSession ? search.tabSession : undefined

  return { tabSession }
}
