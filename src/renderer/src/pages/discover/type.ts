export interface InternalCategory {
  id: string
  title: string
  path: string
  hasSidebar?: boolean
  items: Array<{ id: string; name: string; count?: number }>
}
