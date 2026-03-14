import { CursorIcon, VSCodeIcon, ZedIcon } from '@renderer/components/Icons/SVGIcon'
import type { ExternalAppInfo } from '@shared/externalApp/types'

export const getEditorIcon = (app: ExternalAppInfo, className = 'size-4') => {
  switch (app.id) {
    case 'vscode':
      return <VSCodeIcon className={className} />
    case 'cursor':
      return <CursorIcon className={className} />
    case 'zed':
      return <ZedIcon className={className} />
  }
}

/**
 * Build the protocol URL to open a file/folder in an external editor.
 * @see https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls
 * @see https://github.com/microsoft/vscode/issues/141548#issuecomment-1102200617
 */
export function buildEditorUrl(app: ExternalAppInfo, filePath: string): string {
  const encodedPath = filePath.split(/[/\\]/).map(encodeURIComponent).join('/')
  return `${app.protocol}file/${encodedPath}?windowId=_blank`
}
