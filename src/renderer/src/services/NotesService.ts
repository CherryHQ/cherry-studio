import { loggerService } from '@logger'
import type { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { getFileDirectory } from '@renderer/utils'

const logger = loggerService.withContext('NotesService')

const MARKDOWN_EXT = '.md'
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']

export interface UploadResult {
  uploadedNodes: NotesTreeNode[]
  totalFiles: number
  skippedFiles: number
  fileCount: number
  folderCount: number
}

export async function loadTree(rootPath: string): Promise<NotesTreeNode[]> {
  return window.api.file.getDirectoryStructure(normalizePath(rootPath))
}

export function sortTree(nodes: NotesTreeNode[], sortType: NotesSortType): NotesTreeNode[] {
  const cloned = nodes.map((node) => ({
    ...node,
    children: node.children ? sortTree(node.children, sortType) : undefined
  }))

  const sorter = getSorter(sortType)

  cloned.sort((a, b) => {
    if (a.type === b.type) {
      return sorter(a, b)
    }
    return a.type === 'folder' ? -1 : 1
  })

  return cloned
}

export async function addDir(name: string, parentPath: string): Promise<{ path: string; name: string }> {
  const basePath = normalizePath(parentPath)
  const { safeName } = await window.api.file.checkFileName(basePath, name, false)
  const fullPath = `${basePath}/${safeName}`
  await window.api.file.mkdir(fullPath)
  return { path: fullPath, name: safeName }
}

export async function addNote(
  name: string,
  content: string = '',
  parentPath: string
): Promise<{ path: string; name: string }> {
  const basePath = normalizePath(parentPath)
  const { safeName } = await window.api.file.checkFileName(basePath, name, true)
  const notePath = `${basePath}/${safeName}${MARKDOWN_EXT}`
  await window.api.file.write(notePath, content)
  return { path: notePath, name: safeName }
}

export async function delNode(node: NotesTreeNode): Promise<void> {
  if (node.type === 'folder') {
    await window.api.file.deleteExternalDir(node.externalPath)
  } else {
    await window.api.file.deleteExternalFile(node.externalPath)
  }
}

export async function renameNode(node: NotesTreeNode, newName: string): Promise<{ path: string; name: string }> {
  const isFile = node.type === 'file'
  const parentDir = normalizePath(getFileDirectory(node.externalPath))
  const { safeName, exists } = await window.api.file.checkFileName(parentDir, newName, isFile)

  if (exists) {
    throw new Error(`Target name already exists: ${safeName}`)
  }

  if (isFile) {
    await window.api.file.rename(node.externalPath, safeName)
    return { path: `${parentDir}/${safeName}${MARKDOWN_EXT}`, name: safeName }
  }

  await window.api.file.renameDir(node.externalPath, safeName)
  return { path: `${parentDir}/${safeName}`, name: safeName }
}

export async function uploadNotes(
  files: File[] | Array<{ fullPath: string; isFile: boolean; isDirectory: boolean; systemPath: string }>,
  targetPath: string
): Promise<UploadResult> {
  const basePath = normalizePath(targetPath)

  if (files.length === 0) {
    return {
      uploadedNodes: [],
      totalFiles: 0,
      skippedFiles: 0,
      fileCount: 0,
      folderCount: 0
    }
  }

  const firstItem = files[0]
  const isEntryDataList =
    typeof firstItem === 'object' && 'fullPath' in firstItem && 'systemPath' in firstItem && 'isFile' in firstItem

  if (isEntryDataList) {
    const entries = files as Array<{ fullPath: string; isFile: boolean; isDirectory: boolean; systemPath: string }>
    return uploadNotesRecursive(entries, targetPath)
  }

  // Legacy approach: File objects (for browser File API compatibility)
  const fileList = files as File[]
  const totalFiles = fileList.length

  try {
    const filePaths: string[] = []

    for (const file of fileList) {
      const filePath = window.api.file.getPathForFile(file)

      if (filePath) {
        filePaths.push(filePath)
      } else {
        logger.warn('Failed to get system path for uploaded file:', { fileName: file.name })
        window.toast.warning(`Failed to get system path for file: ${file.name}`)
      }
    }

    if (filePaths.length === 0) {
      return {
        uploadedNodes: [],
        totalFiles,
        skippedFiles: totalFiles,
        fileCount: 0,
        folderCount: 0
      }
    }

    // Pause file watcher to prevent N refresh events
    await window.api.file.pauseFileWatcher()

    // Use simplified batchUpload for File objects
    const result = await window.api.file.batchUpload(filePaths, basePath, {
      allowedExtensions: [MARKDOWN_EXT, ...IMAGE_EXTS]
    })

    return {
      uploadedNodes: [],
      totalFiles,
      skippedFiles: result.skippedFiles,
      fileCount: result.fileCount,
      folderCount: result.folderCount
    }
  } catch (error) {
    logger.error('Legacy file upload failed:', error as Error)
    return {
      uploadedNodes: [],
      totalFiles,
      skippedFiles: totalFiles,
      fileCount: 0,
      folderCount: 0
    }
  }
}

/**
 * Recursive upload for drag-and-drop with fullPath preserved (VS Code approach)
 * Uses batch processing for better performance
 */
async function uploadNotesRecursive(
  entryDataList: Array<{ fullPath: string; isFile: boolean; isDirectory: boolean; systemPath: string }>,
  targetPath: string
): Promise<UploadResult> {
  const basePath = normalizePath(targetPath)

  try {
    // Pause file watcher to prevent N refresh events
    await window.api.file.pauseFileWatcher()

    try {
      // Use batch upload API for better performance (parallel processing in Main process)
      const result = await window.api.file.batchUploadEntries(entryDataList, basePath, {
        allowedExtensions: [MARKDOWN_EXT, ...IMAGE_EXTS]
      })

      return {
        uploadedNodes: [],
        totalFiles: result.fileCount + result.skippedFiles,
        skippedFiles: result.skippedFiles,
        fileCount: result.fileCount,
        folderCount: result.folderCount
      }
    } finally {
      // Resume watcher and trigger single refresh
      await window.api.file.resumeFileWatcher()
    }
  } catch (error) {
    logger.error('Recursive upload failed:', error as Error)
    throw error
  }
}

function getSorter(sortType: NotesSortType): (a: NotesTreeNode, b: NotesTreeNode) => number {
  switch (sortType) {
    case 'sort_a2z':
      return (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'accent' })
    case 'sort_z2a':
      return (a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'accent' })
    case 'sort_updated_desc':
      return (a, b) => getTime(b.updatedAt) - getTime(a.updatedAt)
    case 'sort_updated_asc':
      return (a, b) => getTime(a.updatedAt) - getTime(b.updatedAt)
    case 'sort_created_desc':
      return (a, b) => getTime(b.createdAt) - getTime(a.createdAt)
    case 'sort_created_asc':
      return (a, b) => getTime(a.createdAt) - getTime(b.createdAt)
    default:
      return (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'accent' })
  }
}

function getTime(value?: string): number {
  return value ? new Date(value).getTime() : 0
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

export const findNode = (nodes: NotesTreeNode[], nodeId: string): NotesTreeNode | null => {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node
    }
    if (node.children) {
      const found = findNode(node.children, nodeId)
      if (found) return found
    }
  }
  return null
}
