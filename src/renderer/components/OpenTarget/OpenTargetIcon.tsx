import { FileText, FolderOpen } from 'lucide-react'

import { CursorIcon, FinderIcon, VsCodeIcon, WindowsTerminalIcon, ZedIcon } from '@renderer/components/icons/SvgIcon'
import { isLinux, isMac } from '@renderer/utils/platform'
import type { ExternalOpenTarget } from '@shared/types/externalApp'

export function OpenTargetIcon({ target, className = 'size-4' }: { target: ExternalOpenTarget; className?: string }) {
  const iconName = target.id.startsWith('known:')
    ? target.id.slice('known:'.length)
    : isMac || isLinux
      ? target.name
          ?.trim()
          .replace(/\.app$/i, '')
          .toLowerCase()
      : undefined

  switch (iconName) {
    case 'vscode':
    case 'code':
    case 'visual studio code':
      return <VsCodeIcon className={className} />
    case 'cursor':
      return <CursorIcon className={className} />
    case 'zed':
      return <ZedIcon className={className} />
    case 'wt':
      return <WindowsTerminalIcon className={className} />
  }

  if (target.iconDataUrl) {
    return <img src={target.iconDataUrl} alt="" className={className} draggable={false} />
  }

  if (target.kind === 'file_manager') {
    return isMac ? <FinderIcon className={className} /> : <FolderOpen className={className} />
  }
  return <FileText className={className} />
}
