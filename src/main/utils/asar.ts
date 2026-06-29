import path from 'node:path'

import { app } from 'electron'

export function toAsarUnpackedPath(filePath: string): string {
  if (!app.isPackaged) {
    return filePath
  }

  const appPath = app.getAppPath()
  if (!appPath.endsWith('.asar')) {
    return filePath
  }

  const unpackedAppPath = appPath.replace(/\.asar$/, '.asar.unpacked')
  if (filePath === appPath) {
    return unpackedAppPath
  }

  const appPathPrefix = `${appPath}${path.sep}`
  if (!filePath.startsWith(appPathPrefix)) {
    return filePath
  }

  return path.join(unpackedAppPath, path.relative(appPath, filePath))
}
