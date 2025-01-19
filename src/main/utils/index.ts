import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

export function getResourcePath() {
  return path.join(app.getAppPath(), 'resources')
}

export function getDataPath() {
  const dataPath = path.join(app.getPath('userData'), 'Data')
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true })
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
