import fs from 'node:fs'
import fsAsync from 'node:fs/promises'
import path from 'node:path'

import { app } from 'electron'

export function getResourcePath() {
  return path.join(app.getAppPath(), 'resources')
}

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

export function getDataPath(subPath?: string) {
  const dataPath = path.join(app.getPath('userData'), 'Data')

  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true })
  }

  if (subPath) {
    const fullPath = path.join(dataPath, subPath)
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true })
    }
    return fullPath
  }

  return dataPath
}

export function getInstanceName(baseURL: string) {
  try {
    return new URL(baseURL).host.split('.')[0]
  } catch (error) {
    return ''
  }
}

export function debounce(func: (...args: any[]) => void, wait: number, immediate: boolean = false) {
  let timeout: NodeJS.Timeout | null = null
  return function (...args: any[]) {
    if (timeout) clearTimeout(timeout)
    if (immediate) {
      func(...args)
    } else {
      timeout = setTimeout(() => func(...args), wait)
    }
  }
}

// NOTE: It's an unused function. localStorage should not be accessed in main process.
// export function dumpPersistState() {
//   const persistState = JSON.parse(localStorage.getItem('persist:cherry-studio') || '{}')
//   for (const key in persistState) {
//     persistState[key] = JSON.parse(persistState[key])
//   }
//   return JSON.stringify(persistState)
// }

export const runAsyncFunction = async (fn: () => Promise<void>) => {
  await fn()
}

/**
 * Ensure a directory exists, creating it if necessary.
 * Returns an object indicating success/failure with optional error details.
 * @param dir - The directory path to ensure exists
 * @returns An object with success status and optional error
 */
export function makeSureDirExists(dir: string): { success: boolean; error?: Error } {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      return { success: true }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      // EACCES: permission denied, EPERM: operation not permitted
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        return {
          success: false,
          error: new Error(
            `Permission denied: cannot create directory "${dir}". Please run as administrator or check directory permissions.`
          )
        }
      }
      return { success: false, error: err }
    }
  }
  return { success: true }
}

export async function calculateDirectorySize(directoryPath: string): Promise<number> {
  let totalSize = 0
  const items = await fsAsync.readdir(directoryPath)

  for (const item of items) {
    const itemPath = path.join(directoryPath, item)
    const stats = await fsAsync.stat(itemPath)

    if (stats.isFile()) {
      totalSize += stats.size
    } else if (stats.isDirectory()) {
      totalSize += await calculateDirectorySize(itemPath)
    }
  }
  return totalSize
}

export const removeEnvProxy = (env: Record<string, string>) => {
  delete env.HTTPS_PROXY
  delete env.HTTP_PROXY
  delete env.grpc_proxy
  delete env.http_proxy
  delete env.https_proxy
}
