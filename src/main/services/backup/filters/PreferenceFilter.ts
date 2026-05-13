import type { Client } from '@libsql/client'
import { loggerService } from '@logger'

import type { CancellationToken } from '../CancellationToken'

const logger = loggerService.withContext('PreferenceFilter')

const SENSITIVE_PATTERN = /secret|token|password|api[_-]?key|credential|auth/i
const ABSOLUTE_PATH_PATTERN = /^\/|^[A-Z]:\\/
const MACHINE_STATE_KEYS = new Set([
  'app.zoom_factor',
  'app.window_state',
  'app.sidebar_width',
  'app.last_active_topic'
])

export async function filterPreferences(client: Client, token: CancellationToken): Promise<{ filtered: number }> {
  token.throwIfCancelled()
  const result = await client.execute('SELECT scope, key, value FROM preference')
  const toDelete: Array<{ scope: string; key: string }> = []
  for (const row of result.rows) {
    const key = row.key as string
    const value = row.value as string | null
    if (shouldExclude(key, value)) {
      toDelete.push({ scope: row.scope as string, key })
    }
  }
  for (const { scope, key } of toDelete) {
    token.throwIfCancelled()
    await client.execute({ sql: 'DELETE FROM preference WHERE scope = ? AND key = ?', args: [scope, key] })
  }
  logger.info('Preferences filtered', { removed: toDelete.length })
  return { filtered: toDelete.length }
}

export function shouldExclude(key: string, value: string | null): boolean {
  if (SENSITIVE_PATTERN.test(key)) return true
  if (value && SENSITIVE_PATTERN.test(value)) return true
  if (MACHINE_STATE_KEYS.has(key)) return true
  if (value && ABSOLUTE_PATH_PATTERN.test(value)) return true
  if (key.startsWith('shortcut.') && value?.includes('CommandOrControl')) return true
  return false
}
