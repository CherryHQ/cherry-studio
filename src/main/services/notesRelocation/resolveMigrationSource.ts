import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'

export function resolveNotesRelocationSourcePathFromPreference(): string {
  const configured = application.get('PreferenceService').get('feature.notes.path') || ''
  const defaultDir = path.resolve(application.getPath('feature.notes.data'))

  if (!configured) {
    return defaultDir
  }

  const normalized = path.resolve(configured)
  if (normalized === defaultDir) {
    return defaultDir
  }

  try {
    const stats = fs.statSync(normalized)
    if (stats.isDirectory()) {
      return normalized
    }
  } catch {
    return configured
  }

  return configured
}
