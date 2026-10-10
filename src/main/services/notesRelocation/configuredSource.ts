import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'

import { isAllowedNotesDirectory, realPath } from './validation'

export function resolveConfiguredNotesDirectoryPath(): string {
  const preference = application.get('PreferenceService').get('feature.notes.path')?.trim()
  const defaultPath = application.getPath('feature.notes.data')
  if (!preference) {
    return defaultPath
  }

  const normalized = path.resolve(preference)
  try {
    if (!fs.statSync(normalized).isDirectory()) {
      return defaultPath
    }
    fs.accessSync(normalized, fs.constants.W_OK)
    if (!isAllowedNotesDirectory(normalized)) {
      return defaultPath
    }
    return normalized
  } catch {
    // Missing or non-writable — match renderer resolveNotesPath fallback to default.
  }
  return defaultPath
}

export function assertNotesRelocationSourceStillCurrent(sourcePath: string, expectedSourceRealPath: string): void {
  const configured = resolveConfiguredNotesDirectoryPath()
  const sourceReal = realPath(sourcePath)
  const expectedReal = realPath(expectedSourceRealPath)
  const configuredReal = realPath(configured)

  if (sourceReal !== expectedReal || sourceReal !== configuredReal) {
    throw new Error('notes relocation source is stale')
  }
}
