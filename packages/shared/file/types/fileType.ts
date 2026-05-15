import { audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/config/constant'

import { FILE_TYPE, type FileType } from './common'

const buildFileTypeMap = (): Readonly<Record<string, FileType>> => {
  const entries: Array<[string, FileType]> = []
  const add = (exts: readonly string[], type: FileType) => {
    for (const ext of exts) {
      entries.push([ext.replace(/^\./, '').toLowerCase(), type])
    }
  }
  add(imageExts, FILE_TYPE.IMAGE)
  add(videoExts, FILE_TYPE.VIDEO)
  add(audioExts, FILE_TYPE.AUDIO)
  add(textExts, FILE_TYPE.TEXT)
  add(documentExts, FILE_TYPE.DOCUMENT)
  return Object.freeze(Object.fromEntries(entries))
}

export const fileTypeMap: Readonly<Record<string, FileType>> = buildFileTypeMap()

export function getFileTypeByExt(ext: string): FileType {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  if (!normalized) return FILE_TYPE.OTHER
  return fileTypeMap[normalized] ?? FILE_TYPE.OTHER
}
