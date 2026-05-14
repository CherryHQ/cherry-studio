import type { FileInfo } from '@shared/file/types'

export function getFileNameWithExt(file: Pick<FileInfo, 'name' | 'ext'>): string {
  return file.ext ? `${file.name}.${file.ext}` : file.name
}
