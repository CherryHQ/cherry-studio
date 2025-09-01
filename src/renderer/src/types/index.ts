import type { CSSProperties } from 'react'

export * from './api'
export * from './assistant'
export * from './common'
export * from './file'
export * from './knowledge'
export * from './mcp'
export * from './memory'
export * from './message'
export * from './model'
export * from './newMessage'
export * from './note'
export * from './ocr'
export * from './painting'
export * from './params'
export * from './preprocess'
export * from './provider'
export * from './quickphrase'
export * from './reasoning'
export * from './shortcut'
export * from './topic'
export * from './translate'
export * from './websearch'

export type User = {
  id: string
  name: string
  avatar: string
  email: string
}

export type Suggestion = {
  content: string
}

export type MinAppType = {
  id: string
  name: string
  logo?: string
  url: string
  bodered?: boolean
  background?: string
  style?: CSSProperties
  addTime?: string
  type?: 'Custom' | 'Default' // Added the 'type' property
}

export enum ThemeMode {
  light = 'light',
  dark = 'dark',
  system = 'system'
}

/** 有限的UI语言 */
export type LanguageVarious = 'zh-CN' | 'zh-TW' | 'el-GR' | 'en-US' | 'es-ES' | 'fr-FR' | 'ja-JP' | 'pt-PT' | 'ru-RU'

export type CodeStyleVarious = 'auto' | string

export type WebDavConfig = {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
  fileName?: string
  skipBackupFile?: boolean
  disableStream?: boolean
}

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

export type SidebarIcon =
  | 'assistants'
  | 'agents'
  | 'paintings'
  | 'translate'
  | 'minapp'
  | 'knowledge'
  | 'files'
  | 'code_tools'
  | 'notes'

export type Citation = {
  number: number
  url: string
  title?: string
  hostname?: string
  content?: string
  showFavicon?: boolean
  type?: string
  metadata?: Record<string, any>
}

export type MathEngine = 'KaTeX' | 'MathJax' | 'none'

export type StoreSyncAction = {
  type: string
  payload: any
  meta?: {
    fromSync?: boolean
    source?: string
  }
}

export type S3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  root?: string
  fileName?: string
  skipBackupFile: boolean
  autoSync: boolean
  syncInterval: number
  maxBackups: number
}

// ========================================================================

/**
 * 获取对象的所有键名，并保持类型安全
 * @param obj - 要获取键名的对象
 * @returns 对象的所有键名数组，类型为对象键名的联合类型
 * @example
 * ```ts
 * const obj = { foo: 1, bar: 'hello' };
 * const keys = objectKeys(obj); // ['foo', 'bar']
 * ```
 */
export function objectKeys<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[]
}

/**
 * 将对象转换为键值对数组，保持类型安全
 * @template T - 对象类型
 * @param obj - 要转换的对象
 * @returns 键值对数组，每个元素是一个包含键和值的元组
 * @example
 * const obj = { name: 'John', age: 30 };
 * const entries = objectEntries(obj); // [['name', 'John'], ['age', 30]]
 */
export function objectEntries<T extends object>(obj: T): [keyof T, T[keyof T]][] {
  return Object.entries(obj) as [keyof T, T[keyof T]][]
}

/**
 * 将对象转换为键值对数组，提供更严格的类型检查
 * @template T - 对象类型，键必须是string、number或symbol，值可以是任意类型
 * @param obj - 要转换的对象
 * @returns 键值对数组，每个元素是一个包含键和值的元组，类型完全对应原对象的键值类型
 * @example
 * const obj = { name: 'John', age: 30 };
 * const entries = objectEntriesStrict(obj); // [['name', string], ['age', number]]
 */
export function objectEntriesStrict<T extends Record<string | number | symbol, unknown>>(
  obj: T
): { [K in keyof T]: [K, T[K]] }[keyof T][] {
  return Object.entries(obj) as { [K in keyof T]: [K, T[K]] }[keyof T][]
}

/**
 * 表示一个对象类型，该对象至少包含类型T中指定的所有键，这些键的值类型为U
 * 同时也允许包含其他任意string类型的键，这些键的值类型也必须是U
 * @template T - 必需包含的键的字面量字符串联合类型
 * @template U - 所有键对应值的类型
 * @example
 * type Example = AtLeast<'a' | 'b', number>;
 * // 结果类型允许:
 * const obj1: Example = { a: 1, b: 2 };           // 只包含必需的键
 * const obj2: Example = { a: 1, b: 2, c: 3 };     // 包含额外的键
 */
export type AtLeast<T extends string, U> = {
  [K in T]: U
} & {
  [key: string]: U
}

/**
 * 从对象中移除指定的属性键，返回新对象
 * @template T - 源对象类型
 * @template K - 要移除的属性键类型，必须是T的键
 * @param obj - 源对象
 * @param keys - 要移除的属性键列表
 * @returns 移除指定属性后的新对象
 * @example
 * ```ts
 * const obj = { a: 1, b: 2, c: 3 };
 * const result = strip(obj, ['a', 'b']);
 * // result = { c: 3 }
 * ```
 */
export function strip<T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete (result as any)[key] // 类型上 Omit 已保证安全
  }
  return result
}

export type HexColor = string

/**
 * 检查字符串是否为有效的十六进制颜色值
 * @param value 待检查的字符串
 */
export const isHexColor = (value: string): value is HexColor => {
  return /^#([0-9A-F]{3}){1,2}$/i.test(value)
}
