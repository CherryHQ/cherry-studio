import { describe, expect, it } from 'vitest'

import { backupRequestSchemas } from '../backup'

/**
 * The restore-mode default lives at the ipc boundary: a renderer that sends no
 * mode (no merge UI yet) must reach the service as an explicit 'replace', not as
 * `undefined` — `.optional().default()` order is what makes `{}` resolve, while
 * the reversed order let the documented default never fire.
 */
describe('backup restore-mode input default', () => {
  const prepareInput = backupRequestSchemas['backup.prepare_restore'].input
  const prepareFromDestinationInput = backupRequestSchemas['backup.prepare_restore_from_destination'].input

  it('resolves an omitted mode to replace on prepare_restore', () => {
    expect(prepareInput.parse({})).toEqual({ mode: 'replace' })
  })

  it('resolves an omitted mode to replace on prepare_restore_from_destination', () => {
    const input = prepareFromDestinationInput.parse({ destination: 'local', name: 'backup.cherrybackup' })
    expect(input.mode).toBe('replace')
  })

  it('keeps an explicit merge through both routes', () => {
    expect(prepareInput.parse({ mode: 'merge' })).toEqual({ mode: 'merge' })
    const input = prepareFromDestinationInput.parse({
      destination: 'local',
      name: 'backup.cherrybackup',
      mode: 'merge'
    })
    expect(input.mode).toBe('merge')
  })

  it('rejects an unknown mode', () => {
    expect(prepareInput.safeParse({ mode: 'overwrite' }).success).toBe(false)
  })
})
