export type ModelSettingsFocus = 'default' | 'translate'

export type ModelSettingsSearch = {
  focus?: ModelSettingsFocus
}

export function validateModelSettingsSearch(search: Record<string, unknown>): ModelSettingsSearch {
  return search.focus === 'default' || search.focus === 'translate' ? { focus: search.focus } : {}
}
