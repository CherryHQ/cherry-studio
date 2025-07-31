import { loggerService } from '@logger'
import db from '@renderer/databases'
import FileManager from '@renderer/services/FileManager'
import { FileMetadata, FileTypes } from '@renderer/types'
import { NotesTreeNode } from '@renderer/types/note'
import { v4 as uuidv4 } from 'uuid'

const NOTES_FOLDER_PREFIX = 'notes'
const MARKDOWN_EXT = '.md'

const logger = loggerService.withContext('NotesService')

export class NotesService {
  private static readonly NOTES_STORAGE_KEY = 'notes-tree-structure'

  /**
   * 获取笔记树结构
   */
  static async getNotesTree(): Promise<NotesTreeNode[]> {
    try {
      const storedTree = localStorage.getItem(this.NOTES_STORAGE_KEY)
      const tree: NotesTreeNode[] = storedTree ? JSON.parse(storedTree) : []

      await this.syncFileNames(tree)

      return tree
    } catch (error) {
      logger.error('Failed to get notes tree:', error as Error)
      return []
    }
  }

  /**
   * 同步所有文件节点的名称
   */
  private static async syncFileNames(tree: NotesTreeNode[]): Promise<void> {
    // 收集所有文件ID
    const fileIds: string[] = []
    this.collectFileIds(tree, fileIds)

    if (fileIds.length === 0) return

    try {
      const filesMetadata = await Promise.all(fileIds.map((id) => FileManager.getFile(id)))
      const metadataMap = new Map(filesMetadata.filter((file) => file !== null).map((file) => [file!.id, file]))
      const hasChanges = this.updateFileNames(tree, metadataMap)

      if (hasChanges) {
        await this.saveNotesTree(tree)
      }
    } catch (error) {
      logger.error('Failed to sync file names:', error as Error)
    }
  }

  /**
   * 收集树中所有文件节点的ID
   */
  private static collectFileIds(tree: NotesTreeNode[], fileIds: string[]): void {
    for (const node of tree) {
      if (node.type === 'file' && node.fileId) {
        fileIds.push(node.fileId)
      }
      if (node.children && node.children.length > 0) {
        this.collectFileIds(node.children, fileIds)
      }
    }
  }

  /**
   * 更新树中的文件名称
   * @returns 是否有名称更新
   */
  private static updateFileNames(tree: NotesTreeNode[], metadataMap: Map<string, any>): boolean {
    let hasChanges = false

    for (const node of tree) {
      if (node.type === 'file' && node.fileId) {
        const metadata = metadataMap.get(node.fileId)
        if (metadata && metadata.origin_name !== node.name) {
          node.name = metadata.origin_name
          node.updatedAt = new Date().toISOString()
          hasChanges = true
        }
      }
      if (node.children && node.children.length > 0) {
        const childChanges = this.updateFileNames(node.children, metadataMap)
        hasChanges = hasChanges || childChanges
      }
    }

    return hasChanges
  }

  /**
   * 保存笔记树结构
   */
  static async saveNotesTree(tree: NotesTreeNode[]): Promise<void> {
    try {
      localStorage.setItem(this.NOTES_STORAGE_KEY, JSON.stringify(tree))
    } catch (error) {
      logger.error('Failed to save notes tree:', error as Error)
    }
  }

  /**
   * 创建新文件夹
   */
  static async createFolder(name: string, parentId?: string): Promise<NotesTreeNode> {
    const folderId = uuidv4()
    const folderPath = this.buildPath(name, parentId)

    const folder: NotesTreeNode = {
      id: folderId,
      name,
      type: 'folder',
      path: folderPath,
      children: [],
      expanded: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const tree = await this.getNotesTree()
    this.insertNodeIntoTree(tree, folder, parentId)
    await this.saveNotesTree(tree)

    return folder
  }

  /**
   * 创建新笔记文件
   * 只允许创建Markdown格式的文件，以noteId.md的格式存储
   */
  static async createNote(name: string, content: string = '', parentId?: string): Promise<NotesTreeNode> {
    const noteId = uuidv4()
    const notePath = this.buildPath(name, parentId)

    // 确保文件名是markdown格式
    let displayName = name
    if (!displayName.toLowerCase().endsWith(MARKDOWN_EXT)) {
      displayName += MARKDOWN_EXT
    }

    try {
      const fileMetadata: FileMetadata = {
        id: noteId,
        name: noteId + MARKDOWN_EXT,
        origin_name: displayName,
        path: notePath,
        size: content.length,
        ext: MARKDOWN_EXT,
        type: FileTypes.TEXT,
        created_at: new Date().toISOString(),
        count: 1
      }

      await window.api.file.writeWithId(fileMetadata.id + fileMetadata.ext, content)
      await FileManager.addFile(fileMetadata)

      // 创建树节点
      const note: NotesTreeNode = {
        id: noteId,
        name: displayName,
        type: 'file',
        path: notePath,
        fileId: noteId,
        createdAt: fileMetadata.created_at,
        updatedAt: fileMetadata.created_at
      }

      const tree = await this.getNotesTree()
      this.insertNodeIntoTree(tree, note, parentId)
      await this.saveNotesTree(tree)

      return note
    } catch (error) {
      logger.error('Failed to create note:', error as Error)
      throw error
    }
  }

  /**
   * 读取笔记内容
   */
  static async readNote(node: NotesTreeNode): Promise<string> {
    if (node.type !== 'file' || !node.fileId) {
      throw new Error('Invalid note node')
    }

    try {
      const fileMetadata = await FileManager.getFile(node.fileId)
      if (!fileMetadata) {
        throw new Error('Note file not found in database')
      }

      return await window.api.file.read(fileMetadata.id + fileMetadata.ext)
    } catch (error) {
      logger.error('Failed to read note:', error as Error)
      throw error
    }
  }

  /**
   * 更新笔记内容
   */
  static async updateNote(node: NotesTreeNode, content: string): Promise<void> {
    if (node.type !== 'file' || !node.fileId) {
      throw new Error('Invalid note node')
    }

    try {
      const fileMetadata = await FileManager.getFile(node.fileId)
      if (!fileMetadata) {
        throw new Error('Note file not found in database')
      }

      await window.api.file.writeWithId(fileMetadata.id + fileMetadata.ext, content)
      await db.files.update(fileMetadata.id, {
        size: content.length,
        count: fileMetadata.count + 1
      })

      const tree = await this.getNotesTree()
      const targetNode = this.findNodeInTree(tree, node.id)
      if (targetNode) {
        targetNode.updatedAt = new Date().toISOString()
        await this.saveNotesTree(tree)
      }
    } catch (error) {
      logger.error('Failed to update note:', error as Error)
      throw error
    }
  }

  /**
   * 删除笔记或文件夹
   */
  static async deleteNode(nodeId: string): Promise<void> {
    const tree = await this.getNotesTree()
    const node = this.findNodeInTree(tree, nodeId)

    if (!node) {
      throw new Error('Node not found')
    }

    try {
      await this.deleteNodeRecursively(node)
      this.removeNodeFromTree(tree, nodeId)
      await this.saveNotesTree(tree)
    } catch (error) {
      logger.error('Failed to delete node:', error as Error)
      throw error
    }
  }

  /**
   * 重命名节点
   */
  static async renameNode(nodeId: string, newName: string): Promise<void> {
    const tree = await this.getNotesTree()
    const node = this.findNodeInTree(tree, nodeId)

    if (!node) {
      throw new Error('Node not found')
    }

    // 为文件类型自动添加.md后缀
    let finalName = newName
    if (node.type === 'file' && !finalName.toLowerCase().endsWith(MARKDOWN_EXT)) {
      finalName += MARKDOWN_EXT
    }

    // 更新节点名称
    node.name = finalName
    node.updatedAt = new Date().toISOString()

    // 如果是文件类型，还需要更新文件记录
    if (node.type === 'file' && node.fileId) {
      try {
        // 获取文件元数据
        const fileMetadata = await FileManager.getFile(node.fileId)
        if (fileMetadata) {
          // 更新文件的原始名称（显示名称）
          await db.files.update(node.fileId, {
            origin_name: finalName
          })
        }
      } catch (error) {
        logger.error('Failed to update file metadata:', error as Error)
        throw error
      }
    }

    await this.saveNotesTree(tree)
  }

  /**
   * 切换节点展开状态
   */
  static async toggleNodeExpanded(nodeId: string): Promise<void> {
    const tree = await this.getNotesTree()
    const node = this.findNodeInTree(tree, nodeId)

    if (node && node.type === 'folder') {
      node.expanded = !node.expanded
      await this.saveNotesTree(tree)
    }
  }

  /**
   * 切换收藏状态
   */
  static async toggleStarred(nodeId: string): Promise<void> {
    const tree = await this.getNotesTree()
    const node = this.findNodeInTree(tree, nodeId)

    if (node) {
      node.is_starred = !node.is_starred
      await this.saveNotesTree(tree)
    }
  }

  /**
   * 移动节点到新的父节点
   */
  static async moveNode(nodeId: string, newParentId?: string): Promise<void> {
    const tree = await this.getNotesTree()
    const node = this.findNodeInTree(tree, nodeId)

    if (!node) {
      throw new Error('Node not found')
    }

    this.removeNodeFromTree(tree, nodeId)

    this.insertNodeIntoTree(tree, node, newParentId)

    await this.saveNotesTree(tree)
  }

  /**
   * 构建文件路径
   */
  private static buildPath(name: string, parentId?: string): string {
    const segments = [NOTES_FOLDER_PREFIX]

    if (parentId) {
      // 这里应该根据parentId构建完整路径，简化处理
      segments.push(parentId)
    }

    segments.push(name)
    return segments.join('/')
  }

  /**
   * 在树中插入节点
   */
  private static insertNodeIntoTree(tree: NotesTreeNode[], node: NotesTreeNode, parentId?: string): void {
    if (!parentId) {
      tree.push(node)
      return
    }

    const parent = this.findNodeInTree(tree, parentId)
    if (parent && parent.type === 'folder') {
      if (!parent.children) {
        parent.children = []
      }
      parent.children.push(node)
    }
  }

  /**
   * 在树中查找节点
   */
  private static findNodeInTree(tree: NotesTreeNode[], nodeId: string): NotesTreeNode | null {
    for (const node of tree) {
      if (node.id === nodeId) {
        return node
      }
      if (node.children) {
        const found = this.findNodeInTree(node.children, nodeId)
        if (found) {
          return found
        }
      }
    }
    return null
  }

  /**
   * 从树中移除节点
   */
  private static removeNodeFromTree(tree: NotesTreeNode[], nodeId: string): boolean {
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].id === nodeId) {
        tree.splice(i, 1)
        return true
      }
      if (tree[i].children) {
        const removed = this.removeNodeFromTree(tree[i].children!, nodeId)
        if (removed) {
          return true
        }
      }
    }
    return false
  }

  /**
   * 递归删除节点及其文件
   */
  private static async deleteNodeRecursively(node: NotesTreeNode): Promise<void> {
    if (node.type === 'file' && node.fileId) {
      try {
        await FileManager.deleteFile(node.fileId, true)
      } catch (error) {
        logger.error(`Failed to delete file with id ${node.fileId}:`, error as Error)
      }
    } else if (node.type === 'folder' && node.children) {
      for (const child of node.children) {
        await this.deleteNodeRecursively(child)
      }
    }
  }
}
