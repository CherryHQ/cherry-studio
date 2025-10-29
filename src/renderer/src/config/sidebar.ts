import { SidebarIcon } from '@renderer/types'

/**
 * 默认显示的侧边栏图标
 * 这些图标会在侧边栏中默认显示
 */
export const DEFAULT_SIDEBAR_ICONS: SidebarIcon[] = [
  'assistants',
  'store',
  'paintings',
  'translate',
  'minapp',
  'knowledge',
  'files',
  'code_tools',
  'notes'
]

/**
 * 必须显示的侧边栏图标（不能被隐藏）
 * 这些图标必须始终在侧边栏中可见
 * 抽取为参数方便未来扩展
 */
export const REQUIRED_SIDEBAR_ICONS: SidebarIcon[] = ['assistants']
