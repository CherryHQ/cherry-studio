import { FileMetadata } from './file'

export type SortType = 'name' | 'created' | 'modified' | 'none'
export type SortDirection = 'asc' | 'desc'

/**
 * @interface
 * @description 笔记树节点接口
 */
export interface NotesTreeNode {
  id: string
  name: string
  type: 'folder' | 'file'
  path: string
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
