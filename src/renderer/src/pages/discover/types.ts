import { Category } from '@renderer/types/cherryStore'

export interface DiscoverContextType {
  selectedSubcategory: string
  activeTabId: string
  currentCategory?: Category // currentCategory might be undefined initially
}
