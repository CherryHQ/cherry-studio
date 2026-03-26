import FileExplorerIcon from '@renderer/assets/images/apps/file-explorer.png?url'
import FinderIcon from '@renderer/assets/images/apps/finder.png?url'
import GhosttyIcon from '@renderer/assets/images/apps/ghostty.png?url'
import WarpIcon from '@renderer/assets/images/apps/warp.png?url'
import { CursorIcon, VSCodeIcon, ZedIcon } from '@renderer/components/Icons/SVGIcon'
import { isMac, isWin } from '@renderer/config/constant'
import { terminalApps } from '@shared/config/constant'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { FolderOpen, Terminal } from 'lucide-react'

export const getFileManagerIcon = (size = 16) => {
  if (isMac) return <img src={FinderIcon} alt="Finder" style={{ width: size, height: size }} />
  if (isWin) return <img src={FileExplorerIcon} alt="File Explorer" style={{ width: size, height: size }} />
  return <FolderOpen size={size} />
}

export const getTerminalIcon = (terminalId: string, size = 16) => {
  switch (terminalId) {
    case terminalApps.ghostty:
      return <img src={GhosttyIcon} alt="Ghostty" style={{ width: size, height: size }} />
    case terminalApps.warp:
      return <img src={WarpIcon} alt="Warp" style={{ width: size, height: size }} />
    default:
      return <Terminal size={size} />
  }
}

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
 * @see https://github.com/zed-industries/zed/issues/8482
 */
export function buildEditorUrl(app: ExternalAppInfo, filePath: string): string {
  const encodedPath = filePath.split(/[/\\]/).map(encodeURIComponent).join('/')
  if (app.id === 'zed') {
    // Zed parses URLs by stripping "zed://file" prefix, so the format is
    // zed://file/absolute/path (no extra "/" between "file" and path, no query params)
    return `${app.protocol}file${encodedPath}`
  }
  return `${app.protocol}file/${encodedPath}?windowId=_blank`
}
