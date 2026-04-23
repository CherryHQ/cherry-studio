import type { DirectoryItem } from '../types'

// TODO: will be replace with file manager in the v2
const getDirectoryNameFromFile = (file: File): string | null => {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath

  if (!relativePath || !relativePath.includes('/')) {
    return null
  }

  const [directoryName] = relativePath.split('/')
  return directoryName || null
}

export const buildDirectoryItems = (files: File[]): DirectoryItem[] => {
  const directoryItems = new Map<string, DirectoryItem>()

  files.forEach((file) => {
    const directoryName = getDirectoryNameFromFile(file)

    if (!directoryName) {
      return
    }

    const existingItem = directoryItems.get(directoryName)

    if (existingItem) {
      existingItem.fileCount += 1
      existingItem.totalSize += file.size
      return
    }

    directoryItems.set(directoryName, {
      name: directoryName,
      fileCount: 1,
      totalSize: file.size
    })
  })

  return Array.from(directoryItems.values())
}
