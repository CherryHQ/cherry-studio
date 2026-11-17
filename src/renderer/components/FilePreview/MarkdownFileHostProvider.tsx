import { type ReactNode, useCallback } from 'react'

import { MarkdownHostProvider } from '@renderer/components/markdown'
import { parseFileLinkHref } from '@renderer/utils/filePath'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import { joinPath } from '@renderer/utils/path'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'

import { useOptionalFilePreviewNavigation } from './useFilePreviewNavigation'

function resolveMarkdownImageSrc(filePath: AbsoluteFilePath, src: string): string | null {
  if (!src || src.trim() !== src || /^[/?#]|^[a-z][a-z0-9+.-]*:|[\\\p{Cc}]|%2f|%5c/iu.test(src)) return src

  try {
    return new URL(src, toFileUrl(filePath)).href
  } catch {
    return null
  }
}

function resolveMarkdownFileLink(workspacePath: AbsoluteFilePath, href: string | undefined): AbsoluteFilePath | null {
  const linkPath = parseFileLinkHref(href)
  if (!linkPath) return null

  const candidate = AbsoluteFilePathSchema.safeParse(linkPath).success ? linkPath : joinPath(workspacePath, linkPath)

  try {
    return normalizeFilePreviewPath(candidate)
  } catch {
    return null
  }
}

export function MarkdownFileHostProvider({ filePath, children }: { filePath: AbsoluteFilePath; children: ReactNode }) {
  const navigation = useOptionalFilePreviewNavigation()
  const resolveImageSrc = useCallback((src: string) => resolveMarkdownImageSrc(filePath, src), [filePath])
  const openFilePath = useCallback(
    (path: string) => {
      if (!navigation) return
      const target = resolveMarkdownFileLink(navigation.workspacePath, path)
      if (target) return navigation.openFile(target)
    },
    [navigation]
  )

  return (
    <MarkdownHostProvider resolveImageSrc={resolveImageSrc} openFilePath={navigation ? openFilePath : undefined}>
      {children}
    </MarkdownHostProvider>
  )
}
