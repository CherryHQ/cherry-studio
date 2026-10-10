export interface AssistantCatalogModel {
  id?: string
  provider?: string
  name?: string
  group?: string
}

export interface AssistantCatalogPreset {
  id: string
  name: string
  prompt?: string
  description?: string
  emoji?: string
  group?: string[]
  defaultModel?: AssistantCatalogModel
}

export interface AssistantCatalogTab {
  id: string
  label: string
  count: number
}
