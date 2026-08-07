import { CursorIcon, VsCodeIcon, ZedIcon } from '@renderer/components/icons/SvgIcon'
import type { ExternalAppInfo } from '@shared/types/externalApp'

export const getEditorIcon = (app: ExternalAppInfo, className = 'size-4') => {
  switch (app.id) {
    case 'vscode':
      return <VsCodeIcon className={className} />
    case 'cursor':
      return <CursorIcon className={className} />
    case 'zed':
      return <ZedIcon className={className} />
  }
}
