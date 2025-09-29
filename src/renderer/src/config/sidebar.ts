import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'

//TODO 这个文件是否还有存在的价值？ fullex @ data refactor

/**
 * 默认显示的侧边栏图标
 * 这些图标会在侧边栏中默认显示
 */
// export const DEFAULT_SIDEBAR_ICONS: SidebarIcon[] = [
//   'assistants',
//   'agents',
//   'paintings',
//   'translate',
//   'minapp',
//   'knowledge',
//   'files',
//   'code_tools',
//   'notes'
// ]

/**
 * 必须显示的侧边栏图标（不能被隐藏）
 * 这些图标必须始终在侧边栏中可见
 * 抽取为参数方便未来扩展
 */
export const REQUIRED_SIDEBAR_ICONS: SidebarIcon[] = ['assistants']
