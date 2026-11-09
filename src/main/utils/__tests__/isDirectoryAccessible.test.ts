import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, it } from 'vitest'

import { isDirectoryAccessible } from '../isDirectoryAccessible'

it('checks directory read and traversal permissions, not just existence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'workspace-access-'))
  const folder = path.join(root, 'folder')
  try {
    mkdirSync(folder)
    expect(isDirectoryAccessible(folder)).toBe(true)
    expect(isDirectoryAccessible(path.join(root, 'missing'))).toBe(false)
    writeFileSync(path.join(root, 'file'), '')
    expect(isDirectoryAccessible(path.join(root, 'file'))).toBe(false)
    chmodSync(folder, 0)
    expect(isDirectoryAccessible(folder)).toBe(false)
    chmodSync(folder, 0o700)
    expect(isDirectoryAccessible(folder)).toBe(true)
  } finally {
    chmodSync(folder, 0o700)
    rmSync(root, { recursive: true, force: true })
  }
})
