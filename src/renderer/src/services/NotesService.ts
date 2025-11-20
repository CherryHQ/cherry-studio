import { loggerService } from '@logger'
import type { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { getFileDirectory } from '@renderer/utils'

const logger = loggerService.withContext('NotesService')

const MARKDOWN_EXT = '.md'

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

export async function uploadNotes(files: File[], targetPath: string): Promise<UploadResult> {
  const basePath = normalizePath(targetPath)
  const markdownFiles = filterMarkdown(files)
  const skippedFiles = files.length - markdownFiles.length

  if (markdownFiles.length === 0) {
    return {
      uploadedNodes: [],
      totalFiles: files.length,
      skippedFiles,
      fileCount: 0,
      folderCount: 0
    }
  }

  const folders = collectFolders(markdownFiles, basePath)
  await createFolders(folders)

  let fileCount = 0
  const BATCH_SIZE = 5 // Process 5 files concurrently to balance performance and responsiveness

  // Process files in batches to avoid blocking the UI thread
  for (let i = 0; i < markdownFiles.length; i += BATCH_SIZE) {
    const batch = markdownFiles.slice(i, i + BATCH_SIZE)
    
    // Process current batch in parallel
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const { dir, name } = resolveFileTarget(file, basePath)
        const { safeName } = await window.api.file.checkFileName(dir, name, true)
        const finalPath = `${dir}/${safeName}${MARKDOWN_EXT}`

        const content = await file.text()
        await window.api.file.write(finalPath, content)
        return true
      })
    )

    // Count successful uploads
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        fileCount += 1
      } else {
        logger.error('Failed to write uploaded file:', result.reason)
      }
    })

    // Yield to the event loop between batches to keep UI responsive
    if (i + BATCH_SIZE < markdownFiles.length) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  return {
    uploadedNodes: [],
    totalFiles: files.length,
    skippedFiles,
    fileCount,
    folderCount: folders.size
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

function filterMarkdown(files: File[]): File[] {
  return files.filter((file) => file.name.toLowerCase().endsWith(MARKDOWN_EXT))
}

function collectFolders(files: File[], basePath: string): Set<string> {
  const folders = new Set<string>()

  files.forEach((file) => {
    const relativePath = file.webkitRelativePath || ''
    if (!relativePath.includes('/')) {
      return
    }

    const parts = relativePath.split('/')
    parts.pop()

    let current = basePath
    for (const part of parts) {
      current = `${current}/${part}`
      folders.add(current)
    }
  })

  return folders
}

async function createFolders(folders: Set<string>): Promise<void> {
  const ordered = Array.from(folders).sort((a, b) => a.length - b.length)

  for (const folder of ordered) {
    try {
      await window.api.file.mkdir(folder)
    } catch (error) {
      logger.debug('Skip existing folder while uploading notes', {
        folder,
        error: (error as Error).message
      })
    }
  }
}

function resolveFileTarget(file: File, basePath: string): { dir: string; name: string } {
  if (!file.webkitRelativePath || !file.webkitRelativePath.includes('/')) {
    const nameWithoutExt = file.name.endsWith(MARKDOWN_EXT) ? file.name.slice(0, -MARKDOWN_EXT.length) : file.name
    return { dir: basePath, name: nameWithoutExt }
  }

  const parts = file.webkitRelativePath.split('/')
  const fileName = parts.pop() || file.name
  const dirPath = `${basePath}/${parts.join('/')}`
  const nameWithoutExt = fileName.endsWith(MARKDOWN_EXT) ? fileName.slice(0, -MARKDOWN_EXT.length) : fileName

  return { dir: dirPath, name: nameWithoutExt }
}
