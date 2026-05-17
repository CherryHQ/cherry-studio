export type MobileToolbarScope = 'chat' | 'session' | 'mini-window'

export type MobileToolbarActionType = 'tap'

export type MobileToolbarIconKey =
  | 'paperclip'
  | 'lightbulb'
  | 'globe'
  | 'link'
  | 'hammer'
  | 'wrench'
  | 'command'
  | 'terminal'
  | 'at-sign'
  | 'zap'
  | 'message-square-plus'
  | 'route'
  | 'folder-pen'
  | 'refresh-ccw'
  | 'square-pen'
  | 'sparkles'
  | 'image'
  | 'file-search'
  | 'panel-top-open'
  | 'circle-x'

export interface MobileToolbarToolSnapshot {
  key: string
  label: string
  icon: MobileToolbarIconKey
  active: boolean
  enabled: boolean
}

export interface MobileToolbarSnapshot {
  build: string
  scope: MobileToolbarScope
  tools: MobileToolbarToolSnapshot[]
}

export interface MobileToolbarAction {
  key: string
  action: MobileToolbarActionType
  payload?: Record<string, unknown>
}
