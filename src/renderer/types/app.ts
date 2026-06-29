export type User = {
  id: string
  name: string
  avatar: string
  email: string
}

export type Suggestion = {
  content: string
}

export enum ThemeMode {
  light = 'light',
  dark = 'dark',
  system = 'system'
}

export type CodeStyleVarious = 'auto' | string

export type AppInfo = {
  version: string
  isPackaged: boolean
  appPath: string
  homePath: string
  configPath: string
  appDataPath: string
  resourcesPath: string
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

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

export const AutoDetectionMethods = {
  franc: 'franc',
  llm: 'llm',
  auto: 'auto'
} as const

export type AutoDetectionMethod = keyof typeof AutoDetectionMethods

export type MathEngine = 'KaTeX' | 'none'

export type EditorView = 'preview' | 'source' | 'read'
