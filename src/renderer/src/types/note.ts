export type NotesSortType =
  | 'sort_a2z' // 文件名（A-Z）
  | 'sort_z2a' // 文件名（Z-A）
  | 'sort_updated_desc' // 更新时间（从新到旧）
  | 'sort_updated_asc' // 更新时间（从旧到新）
  | 'sort_created_desc' // 创建时间（从新到旧）
  | 'sort_created_asc' // 创建时间（从旧到新）

/**
 * @interface
 * @description 笔记树节点接口
 */
export interface NotesTreeNode {
  id: string
  name: string // 不包含扩展名
  type: 'folder' | 'file'
  treePath: string // 相对路径
  externalPath: string // 绝对路径
  children?: NotesTreeNode[]
  isStarred?: boolean
  expanded?: boolean
  createdAt: string
  updatedAt: string
}
