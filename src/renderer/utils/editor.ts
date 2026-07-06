import type { ExternalAppInfo } from '@shared/types/externalApp'

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
