export interface SettingsSearchEntry {
  /** Semantic kebab-case aligned with the i18n key tail: settings.proxy.mode.title → proxy-mode */
  anchorId: string
  /** i18n key of the entry title; must exist in locales */
  titleKey: string
  /** Optional description i18n key; participates in matching */
  descriptionKey?: string
  /** Group title i18n key for the result breadcrumb (e.g. settings.launch.title) */
  groupKey?: string
  /** Brand/proper nouns + zh/en synonyms; other locales rely on translated titles */
  aliases?: string[]
  /** Sub-route override for entries living on a nested route (e.g. MCP static tabs) */
  route?: string
  /**
   * In-page panel key for sections that switch panels via component state instead
   * of sub-routes (Data settings): carried as ?panel= on the jump so the target
   * panel mounts before the anchor lookup.
   */
  panel?: string
  /**
   * Provider id for provider-page entries that must select a specific provider
   * on arrival: carried as ?id= (the page consumes it, selects the provider and
   * strips the param).
   */
  providerId?: string
}

export interface SettingsSearchSection {
  /** Section route from the menu array; the aggregation key for `.search.ts` leaves */
  route: string
  /** Menu title key — always searchable as the section baseline */
  sectionTitleKey: string
  entries: SettingsSearchEntry[]
}

/** Shape each `*.search.ts` module must export to contribute leaves */
export interface SettingsSearchSectionModule {
  route: string
  entries: SettingsSearchEntry[]
}

export interface SettingsSearchResult {
  /** Target route on click */
  route: string
  /** In-page panel key (?panel=) for state-switched sections like Data */
  panel?: string
  /** Provider id (?id=) for provider-page entries that select a provider */
  providerId?: string
  /** DOM id to scroll to and flash; undefined when the result is the section itself */
  focusId?: string
  /** Resolved title text for display and highlighting */
  title: string
  /** Resolved description preview */
  description?: string
  /** Resolved breadcrumb parts, outermost first (group title, section title) */
  breadcrumb: string[]
  score: number
}

/** Normalizes a section route into its dom-id slug: '/settings/mcp/servers' → 'mcp-servers' */
function routeSlug(route: string): string {
  return route
    .replace(/^\/+/, '')
    .replace(/^settings\//, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
}

/** Deterministic DOM id for an indexed row: used by `.search.ts` JSX id attributes and focus scrolling */
export function getSettingDomId(route: string, anchorId: string): string {
  return `setting-${routeSlug(route)}-${anchorId}`
}
