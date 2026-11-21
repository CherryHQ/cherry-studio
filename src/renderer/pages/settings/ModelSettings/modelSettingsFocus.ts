export type ModelSettingsFocus = 'default' | 'translate'

export type ModelSettingsSearch = {
  focus?: ModelSettingsFocus
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The URL may carry invalid focus values or unrelated keys; the two literals below define the accepted selection.
export function validateModelSettingsSearch(search: Record<string, unknown>): ModelSettingsSearch {
  return search.focus === 'default' || search.focus === 'translate' ? { focus: search.focus } : {}
}
