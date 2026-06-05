import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// `getWorkspacePathWarning` produces the message via the real main-side `t()`,
// so drive the language layer: `app.getLocale()` picks en-US and the
// application mock leaves `app.language` unset so it falls through to the
// locale. This exercises the full status → reason → i18n'd-message path,
// including `{{path}}` interpolation.
vi.mock('electron', () => ({ app: { getLocale: () => 'en-US' } }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { getWorkspacePathWarning } = await import('../workspacePathWarning')

describe('getWorkspacePathWarning', () => {
  it('returns null for an existing directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cherry-wpw-'))
    await expect(getWorkspacePathWarning(dir)).resolves.toBeNull()
  })

  it('warns (with the path interpolated) when the directory is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-wpw-'))
    const missing = path.join(root, 'does-not-exist')

    const warning = await getWorkspacePathWarning(missing)
    expect(warning).toBeTruthy()
    expect(warning).toContain(missing) // {{path}} was interpolated by main `t()`
  })

  it('warns differently when the path is a file rather than a directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-wpw-'))
    const file = path.join(root, 'f.txt')
    await writeFile(file, 'i am a file')
    const missing = path.join(root, 'does-not-exist')

    const fileWarning = await getWorkspacePathWarning(file)
    const missingWarning = await getWorkspacePathWarning(missing)
    expect(fileWarning).toBeTruthy()
    expect(fileWarning).toContain(file)
    // The reason mapping is distinct: "not a directory" ≠ "does not exist".
    expect(fileWarning).not.toBe(missingWarning)
  })
})
