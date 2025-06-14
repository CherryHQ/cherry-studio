export type TriggerMode = 'selected' | 'ctrlkey' | 'shortcut'
export type FilterMode = 'default' | 'whitelist' | 'blacklist'
export interface ActionItem {
  id: string
  name: string
  enabled: boolean
  isBuiltIn: boolean
  icon?: string
  prompt?: string
  assistantId?: string
  selectedText?: string
  searchEngine?: string
}

export interface SelectionState {
  selectionEnabled: boolean
  triggerMode: TriggerMode
  isCompact: boolean
  isAutoClose: boolean
  isAutoPin: boolean
  isFollowToolbar: boolean
  isRemeberWinSize: boolean
  filterMode: FilterMode
  filterList: string[]
  actionWindowOpacity: number
  actionItems: ActionItem[]
}
