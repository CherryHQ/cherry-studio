export type AppInfo = {
  version: string
  isPackaged: boolean
  appPath: string
  configPath: string
  appDataPath: string
  resourcesPath: string
  filesPath: string
  logsPath: string
  arch: string
  isPortable: boolean
  installPath: string
}

export interface Shortcut {
  key: string
  shortcut: string[]
  editable: boolean
  enabled: boolean
  system: boolean
}

export type User = {
  id: string
  name: string
  avatar: string
  email: string
}

export type SidebarIcon =
  | 'assistants'
  | 'store'
  | 'paintings'
  | 'translate'
  | 'minapp'
  | 'knowledge'
  | 'files'
  | 'code_tools'
  | 'notes'

export interface StoreSyncAction {
  type: string
  payload: any
  meta?: {
    fromSync?: boolean
    source?: string
  }
}

export enum ThemeMode {
  light = 'light',
  dark = 'dark',
  system = 'system'
}

export type CodeStyleVarious = 'auto' | string

export type MathEngine = 'KaTeX' | 'MathJax' | 'none'

export type HexColor = string

/**
 * 检查字符串是否为有效的十六进制颜色值
 * @param value 待检查的字符串
 */
export const isHexColor = (value: string): value is HexColor => {
  return /^#([0-9A-F]{3}){1,2}$/i.test(value)
}
