import type { SidebarEntry } from '@shared/data/preference/preferenceTypes'

//TODO 这个文件是否还有存在的价值？ fullex @ data refactor

/**
 * 默认显示的侧边栏入口
 * 这些入口会在侧边栏中默认显示
 */
// export const DEFAULT_SIDEBAR_ENTRIES: SidebarEntry[] = [

/**
 * 必须显示的侧边栏入口（不能被隐藏）
 * 这些入口必须始终在侧边栏中可见
 * 抽取为参数方便未来扩展
 */
export const REQUIRED_SIDEBAR_ENTRIES: SidebarEntry[] = ['assistants']
