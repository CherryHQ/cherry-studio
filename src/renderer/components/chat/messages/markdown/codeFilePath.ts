import { isInlineFilePath, normalizeInlineFilePath } from '@renderer/utils/filePath'
import { isWin } from '@renderer/utils/platform'
import { isKnownNavigationPath } from '@shared/utils/navigationPath'

export function getCodeFilePath({ text, language }: { text: string; language: string | null }) {
  if (language !== null && language !== 'text') return null
  const path = normalizeInlineFilePath(text)
  return path && (isKnownNavigationPath(path) || (!isWin && isInlineFilePath(text))) ? path : null
}
