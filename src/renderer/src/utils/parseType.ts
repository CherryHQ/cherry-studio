import { FileTypes } from '@renderer/types'

export function parseFileTypes(str: string): FileTypes | null {
  if (Object.values(FileTypes).includes(str as FileTypes)) {
    return str as FileTypes
  }
  return null
}
