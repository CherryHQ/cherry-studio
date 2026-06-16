import type { SidebarFavorite } from '@shared/data/preference/preferenceTypes'

//TODO 这个文件是否还有存在的价值？ fullex @ data refactor

/**
 * 默认显示的侧边栏收藏项
 * 这些收藏项会在侧边栏中默认显示
 */
// export const DEFAULT_SIDEBAR_FAVORITES: SidebarFavorite[] = [

/**
 * 必须显示的侧边栏收藏项（不能被隐藏）
 * 这些收藏项必须始终在侧边栏中可见
 * 抽取为参数方便未来扩展
 */
export const REQUIRED_SIDEBAR_FAVORITES: SidebarFavorite[] = ['assistants']
