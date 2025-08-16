import { FileMetadata } from './file'

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
  name: string
  type: 'folder' | 'file'
  treePath?: string // 在文件树中的路径，区别于FileMetadata的path
  children?: NotesTreeNode[]
  is_starred?: boolean
  expanded?: boolean
  fileId?: string // 文件类型节点对应的FileManager中的文件ID
  createdAt: string
  updatedAt: string
}

/**
 * @interface
 * @description 笔记文件接口，继承FileMetadata
 */
export interface NoteFile extends FileMetadata {
  content?: string // 笔记内容
  parentId?: string // 父节点ID
  isStarred?: boolean // 是否收藏
}
