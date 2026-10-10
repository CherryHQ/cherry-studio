import { FileText, FolderOpen } from 'lucide-react'

import { CursorIcon, FinderIcon, VsCodeIcon, WindowsTerminalIcon, ZedIcon } from '@renderer/components/icons/SvgIcon'
import { isMac } from '@renderer/utils/platform'
import type { ExternalOpenTarget } from '@shared/types/externalApp'

export function OpenTargetIcon({ target, className = 'size-4' }: { target: ExternalOpenTarget; className?: string }) {
  if (target.iconDataUrl) {
    return <img src={target.iconDataUrl} alt="" className={className} draggable={false} />
  }

  switch (target.id) {
    case 'known:vscode':
      return <VsCodeIcon className={className} />
    case 'known:cursor':
      return <CursorIcon className={className} />
    case 'known:zed':
      return <ZedIcon className={className} />
    case 'known:wt':
      return <WindowsTerminalIcon className={className} />
  }

  if (target.kind === 'file_manager') {
    return isMac ? <FinderIcon className={className} /> : <FolderOpen className={className} />
  }
  return <FileText className={className} />
}
