import { loggerService } from '@logger'
import db from '@renderer/databases'
import {
  findNodeInTree,
  findParentNode,
  getNotesTree,
  insertNodeIntoTree,
  isParentNode,
  moveNodeInTree,
  removeNodeFromTree,
  renameNodeFromTree
} from '@renderer/services/NotesTreeService'
import { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { getFileDirectory } from '@renderer/utils'
import { v4 as uuidv4 } from 'uuid'

const MARKDOWN_EXT = '.md'
const NOTES_TREE_ID = 'notes-tree-structure'

const logger = loggerService.withContext('NotesService')

export type MoveNodeResult = { success: false } | { success: true; type: 'file_system_move' | 'manual_reorder' }

/**
 * 初始化/同步笔记树结构
 */
export async function initWorkSpace(folderPath: string, sortType: NotesSortType): Promise<void> {
  const tree = await window.api.file.getDirectoryStructure(folderPath)
  await sortAllLevels(sortType, tree)
}

/**
 * 创建新文件夹
 */
export async function createFolder(name: string, folderPath: string): Promise<NotesTreeNode> {
  const { safeName, exists } = await window.api.file.checkFileName(folderPath, name, false)
  if (exists) {
    logger.warn(`Folder already exists: ${safeName}`)
  }

  const tree = await getNotesTree()
  const folderId = uuidv4()

  const targetPath = await window.api.file.mkdir(`${folderPath}/${safeName}`)

  // 查找父节点ID
  const parentNode = tree.find((node) => node.externalPath === folderPath) || findNodeByExternalPath(tree, folderPath)

  const folder: NotesTreeNode = {
    id: folderId,
    name: safeName,
    treePath: parentNode ? `${parentNode.treePath}/${safeName}` : `/${safeName}`,
    externalPath: targetPath,
    type: 'folder',
    children: [],
    expanded: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  insertNodeIntoTree(tree, folder, parentNode?.id)

  return folder
}

/**
 * 创建新笔记文件
 */
export async function createNote(name: string, content: string = '', folderPath: string): Promise<NotesTreeNode> {
  const { safeName, exists } = await window.api.file.checkFileName(folderPath, name, true)
  if (exists) {
    logger.warn(`Note already exists: ${safeName}`)
  }

  const tree = await getNotesTree()
  const noteId = uuidv4()
  const notePath = `${folderPath}/${safeName}${MARKDOWN_EXT}`

  await window.api.file.write(notePath, content)

  // 查找父节点ID
  const parentNode = tree.find((node) => node.externalPath === folderPath) || findNodeByExternalPath(tree, folderPath)

  const note: NotesTreeNode = {
    id: noteId,
    name: safeName,
    treePath: parentNode ? `${parentNode.treePath}/${safeName}` : `/${safeName}`,
    externalPath: notePath,
    type: 'file',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  insertNodeIntoTree(tree, note, parentNode?.id)

  return note
}

export interface UploadResult {
  uploadedNodes: NotesTreeNode[]
  totalFiles: number
  skippedFiles: number
  fileCount: number
  folderCount: number
}

/**
 * 上传文件或文件夹，支持单个或批量上传，保持文件夹结构
 */
export async function uploadFiles(files: File[], targetFolderPath: string): Promise<UploadResult> {
  const tree = await getNotesTree()
  const uploadedNodes: NotesTreeNode[] = []
  let skippedFiles = 0

  const markdownFiles = filterMarkdownFiles(files)
  skippedFiles = files.length - markdownFiles.length

  if (markdownFiles.length === 0) {
    return createEmptyUploadResult(files.length, skippedFiles)
  }

  // 处理重复的根文件夹名称
  const processedFiles = await processDuplicateRootFolders(markdownFiles, targetFolderPath)

  const { filesByPath, foldersToCreate } = groupFilesByPath(processedFiles, targetFolderPath)

  const createdFolders = await createFoldersSequentially(foldersToCreate, targetFolderPath, tree, uploadedNodes)

  await uploadAllFiles(filesByPath, targetFolderPath, tree, createdFolders, uploadedNodes)

  const fileCount = uploadedNodes.filter((node) => node.type === 'file').length
  const folderCount = uploadedNodes.filter((node) => node.type === 'folder').length

  return {
    uploadedNodes,
    totalFiles: files.length,
    skippedFiles,
    fileCount,
    folderCount
  }
}

/**
 * 删除笔记或文件夹
 */
export async function deleteNode(nodeId: string): Promise<void> {
  const tree = await getNotesTree()
  const node = findNodeInTree(tree, nodeId)
  if (!node) {
    throw new Error('Node not found')
  }
  if (node.type === 'folder') {
    await window.api.file.deleteExternalDir(node.externalPath)
  } else if (node.type === 'file') {
    await window.api.file.deleteExternalFile(node.externalPath)
  }

  await removeNodeFromTree(tree, nodeId)
}

/**
 * 重命名笔记或文件夹
 */
export async function renameNode(nodeId: string, newName: string): Promise<NotesTreeNode> {
  const tree = await getNotesTree()
  const node = findNodeInTree(tree, nodeId)
  if (!node) {
    throw new Error('Node not found')
  }

  const dirPath = getFileDirectory(node.externalPath)
  const { safeName, exists } = await window.api.file.checkFileName(dirPath, newName, node.type === 'file')

  if (exists) {
    logger.warn(`Target name already exists: ${safeName}`)
    throw new Error(`Target name already exists: ${safeName}`)
  }

  if (node.type === 'file') {
    await window.api.file.rename(node.externalPath, safeName)
  } else if (node.type === 'folder') {
    await window.api.file.renameDir(node.externalPath, safeName)
  }
  return renameNodeFromTree(tree, nodeId, safeName)
}

/**
 * 移动节点
 */
export async function moveNode(
  sourceNodeId: string,
  targetNodeId: string,
  position: 'before' | 'after' | 'inside'
): Promise<MoveNodeResult> {
  try {
    const tree = await getNotesTree()

    // 找到源节点和目标节点
    const sourceNode = findNodeInTree(tree, sourceNodeId)
    const targetNode = findNodeInTree(tree, targetNodeId)

    if (!sourceNode || !targetNode) {
      logger.error(`Move nodes failed: node not found (source: ${sourceNodeId}, target: ${targetNodeId})`)
      return { success: false }
    }

    // 不允许文件夹被放入文件中
    if (position === 'inside' && targetNode.type === 'file' && sourceNode.type === 'folder') {
      logger.error('Move nodes failed: cannot move a folder inside a file')
      return { success: false }
    }

    // 不允许将节点移动到自身内部
    if (position === 'inside' && isParentNode(tree, sourceNodeId, targetNodeId)) {
      logger.error('Move nodes failed: cannot move a node inside itself or its descendants')
      return { success: false }
    }

    let targetPath: string = ''

    if (position === 'inside') {
      // 目标是文件夹内部
      if (targetNode.type === 'folder') {
        targetPath = targetNode.externalPath
      } else {
        logger.error('Cannot move node inside a file node')
        return { success: false }
      }
    } else {
      const targetParent = findParentNode(tree, targetNodeId)
      if (targetParent) {
        targetPath = targetParent.externalPath
      } else {
        targetPath = getFileDirectory(targetNode.externalPath!)
      }
    }

    // 检查是否为同级拖动排序
    const sourceParent = findParentNode(tree, sourceNodeId)
    const sourceDir = sourceParent ? sourceParent.externalPath : getFileDirectory(sourceNode.externalPath!)

    const isSameLevelReorder = position !== 'inside' && sourceDir === targetPath

    if (isSameLevelReorder) {
      // 同级拖动排序：跳过文件系统操作，只更新树结构
      logger.debug(`Same level reorder detected, skipping file system operations`)
      const success = await moveNodeInTree(tree, sourceNodeId, targetNodeId, position)
      // 返回一个特殊标识，告诉调用方这是手动排序，不需要重新自动排序
      return success ? { success: true, type: 'manual_reorder' } : { success: false }
    }

    // 构建新的文件路径
    const sourceName = sourceNode.externalPath!.split('/').pop()!
    const sourceNameWithoutExt = sourceName.replace(sourceNode.type === 'file' ? MARKDOWN_EXT : '', '')

    const { safeName } = await window.api.file.checkFileName(
      targetPath,
      sourceNameWithoutExt,
      sourceNode.type === 'file'
    )

    const baseName = safeName + (sourceNode.type === 'file' ? MARKDOWN_EXT : '')
    const newPath = `${targetPath}/${baseName}`

    if (sourceNode.externalPath !== newPath) {
      try {
        if (sourceNode.type === 'folder') {
          await window.api.file.moveDir(sourceNode.externalPath, newPath)
        } else {
          await window.api.file.move(sourceNode.externalPath, newPath)
        }
        sourceNode.externalPath = newPath
        logger.debug(`Moved external ${sourceNode.type} to: ${newPath}`)
      } catch (error) {
        logger.error(`Failed to move external ${sourceNode.type}:`, error as Error)
        return { success: false }
      }
    }

    const success = await moveNodeInTree(tree, sourceNodeId, targetNodeId, position)
    return success ? { success: true, type: 'file_system_move' } : { success: false }
  } catch (error) {
    logger.error('Move nodes failed:', error as Error)
    return { success: false }
  }
}

/**
 * 对节点数组进行排序
 */
function sortNodesArray(nodes: NotesTreeNode[], sortType: NotesSortType): void {
  // 首先分离文件夹和文件
  const folders: NotesTreeNode[] = nodes.filter((node) => node.type === 'folder')
  const files: NotesTreeNode[] = nodes.filter((node) => node.type === 'file')

  // 根据排序类型对文件夹和文件分别进行排序
  const sortFunction = getSortFunction(sortType)
  folders.sort(sortFunction)
  files.sort(sortFunction)

  // 清空原数组并重新填入排序后的节点
  nodes.length = 0
  nodes.push(...folders, ...files)
}

/**
 * 根据排序类型获取相应的排序函数
 */
function getSortFunction(sortType: NotesSortType): (a: NotesTreeNode, b: NotesTreeNode) => number {
  switch (sortType) {
    case 'sort_a2z':
      return (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' })

    case 'sort_z2a':
      return (a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'accent' })

    case 'sort_updated_desc':
      return (a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return timeB - timeA
      }

    case 'sort_updated_asc':
      return (a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return timeA - timeB
      }

    case 'sort_created_desc':
      return (a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return timeB - timeA
      }

    case 'sort_created_asc':
      return (a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return timeA - timeB
      }

    default:
      return (a, b) => a.name.localeCompare(b.name)
  }
}

/**
 * 递归排序笔记树中的所有层级
 */
export async function sortAllLevels(sortType: NotesSortType, tree?: NotesTreeNode[]): Promise<void> {
  try {
    if (!tree) {
      tree = await getNotesTree()
    }
    sortNodesArray(tree, sortType)
    recursiveSortNodes(tree, sortType)
    await db.notes_tree.put({ id: NOTES_TREE_ID, tree })
    logger.info(`Sorted all levels of notes successfully: ${sortType}`)
  } catch (error) {
    logger.error('Failed to sort all levels of notes:', error as Error)
    throw error
  }
}

/**
 * 递归对节点中的子节点进行排序
 */
function recursiveSortNodes(nodes: NotesTreeNode[], sortType: NotesSortType): void {
  for (const node of nodes) {
    if (node.type === 'folder' && node.children && node.children.length > 0) {
      sortNodesArray(node.children, sortType)
      recursiveSortNodes(node.children, sortType)
    }
  }
}

/**
 * 根据外部路径查找节点（递归查找）
 */
function findNodeByExternalPath(nodes: NotesTreeNode[], externalPath: string): NotesTreeNode | null {
  for (const node of nodes) {
    if (node.externalPath === externalPath) {
      return node
    }
    if (node.children && node.children.length > 0) {
      const found = findNodeByExternalPath(node.children, externalPath)
      if (found) {
        return found
      }
    }
  }
  return null
}

/**
 * 过滤出 Markdown 文件
 */
function filterMarkdownFiles(files: File[]): File[] {
  return Array.from(files).filter((file) => {
    if (file.name.toLowerCase().endsWith(MARKDOWN_EXT)) {
      return true
    }
    logger.warn(`Skipping non-markdown file: ${file.name}`)
    return false
  })
}

/**
 * 创建空的上传结果
 */
function createEmptyUploadResult(totalFiles: number, skippedFiles: number): UploadResult {
  return {
    uploadedNodes: [],
    totalFiles,
    skippedFiles,
    fileCount: 0,
    folderCount: 0
  }
}

/**
 * 处理重复的根文件夹名称，为重复的文件夹重写 webkitRelativePath
 */
async function processDuplicateRootFolders(markdownFiles: File[], targetFolderPath: string): Promise<File[]> {
  // 按根文件夹名称分组文件
  const filesByRootFolder = new Map<string, File[]>()
  const processedFiles: File[] = []

  for (const file of markdownFiles) {
    const filePath = file.webkitRelativePath || file.name

    if (filePath.includes('/')) {
      const rootFolderName = filePath.substring(0, filePath.indexOf('/'))
      if (!filesByRootFolder.has(rootFolderName)) {
        filesByRootFolder.set(rootFolderName, [])
      }
      filesByRootFolder.get(rootFolderName)!.push(file)
    } else {
      // 单个文件，直接添加
      processedFiles.push(file)
    }
  }

  // 为每个根文件夹组生成唯一的文件夹名称
  for (const [rootFolderName, files] of filesByRootFolder.entries()) {
    const { safeName } = await window.api.file.checkFileName(targetFolderPath, rootFolderName, false)

    for (const file of files) {
      // 创建一个新的 File 对象，并修改 webkitRelativePath
      const originalPath = file.webkitRelativePath || file.name
      const relativePath = originalPath.substring(originalPath.indexOf('/') + 1)
      const newPath = `${safeName}/${relativePath}`

      const newFile = new File([file], file.name, {
        type: file.type,
        lastModified: file.lastModified
      })

      Object.defineProperty(newFile, 'webkitRelativePath', {
        value: newPath,
        writable: false
      })

      processedFiles.push(newFile)
    }
  }

  return processedFiles
}

/**
 * 按路径分组文件并收集需要创建的文件夹
 */
function groupFilesByPath(
  markdownFiles: File[],
  targetFolderPath: string
): { filesByPath: Map<string, File[]>; foldersToCreate: Set<string> } {
  const filesByPath = new Map<string, File[]>()
  const foldersToCreate = new Set<string>()

  for (const file of markdownFiles) {
    const filePath = file.webkitRelativePath || file.name
    const relativeDirPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : ''
    const fullDirPath = relativeDirPath ? `${targetFolderPath}/${relativeDirPath}` : targetFolderPath

    if (relativeDirPath) {
      const pathParts = relativeDirPath.split('/')

      let currentPath = targetFolderPath
      for (const part of pathParts) {
        currentPath = `${currentPath}/${part}`
        foldersToCreate.add(currentPath)
      }
    }

    if (!filesByPath.has(fullDirPath)) {
      filesByPath.set(fullDirPath, [])
    }
    filesByPath.get(fullDirPath)!.push(file)
  }

  return { filesByPath, foldersToCreate }
}

/**
 * 顺序创建文件夹（避免竞争条件）
 */
async function createFoldersSequentially(
  foldersToCreate: Set<string>,
  targetFolderPath: string,
  tree: NotesTreeNode[],
  uploadedNodes: NotesTreeNode[]
): Promise<Map<string, NotesTreeNode>> {
  const createdFolders = new Map<string, NotesTreeNode>()
  const sortedFolders = Array.from(foldersToCreate).sort()
  const folderCreationLock = new Set<string>()

  for (const folderPath of sortedFolders) {
    if (folderCreationLock.has(folderPath)) {
      continue
    }
    folderCreationLock.add(folderPath)

    try {
      const result = await createSingleFolder(folderPath, targetFolderPath, tree, createdFolders)
      if (result) {
        createdFolders.set(folderPath, result)
        if (result.externalPath !== folderPath) {
          createdFolders.set(result.externalPath, result)
        }
        uploadedNodes.push(result)
        logger.debug(`Created folder: ${folderPath} -> ${result.externalPath}`)
      }
    } catch (error) {
      logger.error(`Failed to create folder ${folderPath}:`, error as Error)
    } finally {
      folderCreationLock.delete(folderPath)
    }
  }

  return createdFolders
}

/**
 * 创建单个文件夹
 */
async function createSingleFolder(
  folderPath: string,
  targetFolderPath: string,
  tree: NotesTreeNode[],
  createdFolders: Map<string, NotesTreeNode>
): Promise<NotesTreeNode | null> {
  const existingNode = findNodeByExternalPath(tree, folderPath)
  if (existingNode) {
    return existingNode
  }

  const relativePath = folderPath.replace(targetFolderPath + '/', '')
  const originalFolderName = relativePath.split('/').pop()!
  const parentFolderPath = folderPath.substring(0, folderPath.lastIndexOf('/'))

  const { safeName: safeFolderName, exists } = await window.api.file.checkFileName(
    parentFolderPath,
    originalFolderName,
    false
  )

  const actualFolderPath = `${parentFolderPath}/${safeFolderName}`

  if (exists) {
    logger.warn(`Folder already exists, creating with new name: ${originalFolderName} -> ${safeFolderName}`)
  }

  try {
    await window.api.file.mkdir(actualFolderPath)
  } catch (error) {
    logger.debug(`Error creating folder: ${actualFolderPath}`, error as Error)
  }

  let parentNode: NotesTreeNode | null
  if (parentFolderPath === targetFolderPath) {
    parentNode =
      tree.find((node) => node.externalPath === targetFolderPath) || findNodeByExternalPath(tree, targetFolderPath)
  } else {
    parentNode = createdFolders.get(parentFolderPath) || null
    if (!parentNode) {
      parentNode = tree.find((node) => node.externalPath === parentFolderPath) || null
      if (!parentNode) {
        parentNode = findNodeByExternalPath(tree, parentFolderPath)
      }
    }
  }

  const folderId = uuidv4()
  const folder: NotesTreeNode = {
    id: folderId,
    name: safeFolderName,
    treePath: parentNode ? `${parentNode.treePath}/${safeFolderName}` : `/${safeFolderName}`,
    externalPath: actualFolderPath,
    type: 'folder',
    children: [],
    expanded: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  await insertNodeIntoTree(tree, folder, parentNode?.id)
  return folder
}

/**
 * 读取文件内容（支持大文件处理）
 */
async function readFileContent(file: File): Promise<string> {
  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

  if (file.size > MAX_FILE_SIZE) {
    logger.warn(
      `Large file detected (${Math.round(file.size / 1024 / 1024)}MB): ${file.name}. Consider using streaming for better performance.`
    )
  }

  try {
    return await file.text()
  } catch (error) {
    logger.error(`Failed to read file content for ${file.name}:`, error as Error)
    throw new Error(`Failed to read file content: ${file.name}`)
  }
}

/**
 * 上传所有文件
 */
async function uploadAllFiles(
  filesByPath: Map<string, File[]>,
  targetFolderPath: string,
  tree: NotesTreeNode[],
  createdFolders: Map<string, NotesTreeNode>,
  uploadedNodes: NotesTreeNode[]
): Promise<void> {
  const uploadPromises: Promise<NotesTreeNode | null>[] = []

  for (const [dirPath, dirFiles] of filesByPath.entries()) {
    for (const file of dirFiles) {
      const uploadPromise = uploadSingleFile(file, dirPath, targetFolderPath, tree, createdFolders)
        .then((result) => {
          if (result) {
            logger.debug(`Uploaded file: ${result.externalPath}`)
          }
          return result
        })
        .catch((error) => {
          logger.error(`Failed to upload file ${file.name}:`, error as Error)
          return null
        })

      uploadPromises.push(uploadPromise)
    }
  }

  const results = await Promise.all(uploadPromises)

  results.forEach((result) => {
    if (result) {
      uploadedNodes.push(result)
    }
  })
}

/**
 * 上传单个文件，需要根据实际创建的文件夹路径来找到正确的父节点
 */
async function uploadSingleFile(
  file: File,
  originalDirPath: string,
  targetFolderPath: string,
  tree: NotesTreeNode[],
  createdFolders: Map<string, NotesTreeNode>
): Promise<NotesTreeNode | null> {
  const fileName = (file.webkitRelativePath || file.name).split('/').pop()!
  const nameWithoutExt = fileName.replace(MARKDOWN_EXT, '')

  let actualDirPath = originalDirPath
  let parentNode: NotesTreeNode | null = null

  if (originalDirPath === targetFolderPath) {
    parentNode =
      tree.find((node) => node.externalPath === targetFolderPath) || findNodeByExternalPath(tree, targetFolderPath)

    if (!parentNode) {
      logger.debug(`Uploading file ${fileName} to root directory: ${targetFolderPath}`)
    }
  } else {
    parentNode = createdFolders.get(originalDirPath) || null
    if (!parentNode) {
      parentNode = tree.find((node) => node.externalPath === originalDirPath) || null
      if (!parentNode) {
        parentNode = findNodeByExternalPath(tree, originalDirPath)
      }
    }

    if (!parentNode) {
      for (const [originalPath, createdNode] of createdFolders.entries()) {
        if (originalPath === originalDirPath) {
          parentNode = createdNode
          actualDirPath = createdNode.externalPath
          break
        }
      }
    }

    if (!parentNode) {
      logger.error(`Cannot upload file ${fileName}: parent node not found for path ${originalDirPath}`)
      return null
    }
  }

  const { safeName, exists } = await window.api.file.checkFileName(actualDirPath, nameWithoutExt, true)
  if (exists) {
    logger.warn(`Note already exists, will be overwritten: ${safeName}`)
  }

  const notePath = `${actualDirPath}/${safeName}${MARKDOWN_EXT}`

  const noteId = uuidv4()
  const note: NotesTreeNode = {
    id: noteId,
    name: safeName,
    treePath: parentNode ? `${parentNode.treePath}/${safeName}` : `/${safeName}`,
    externalPath: notePath,
    type: 'file',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const content = await readFileContent(file)
  await window.api.file.write(notePath, content)
  await insertNodeIntoTree(tree, note, parentNode?.id)

  return note
}
