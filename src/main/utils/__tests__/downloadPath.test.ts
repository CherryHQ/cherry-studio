import * as path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { resolveDownloadSavePath } from '../downloadPath'

const dir = path.join('downloads', '')

describe('resolveDownloadSavePath', () => {
  it('keeps the suggested filename when nothing collides', () => {
    const exists = vi.fn(() => false)
    expect(resolveDownloadSavePath(dir, 'paper.pdf', exists)).toBe(path.join(dir, 'paper.pdf'))
    expect(exists).toHaveBeenCalledExactlyOnceWith(path.join(dir, 'paper.pdf'))
  })

  it('appends an incrementing counter before the extension on collisions', () => {
    const taken = new Set(['paper.pdf', 'paper (1).pdf', 'paper (2).pdf'].map((name) => path.join(dir, name)))
    expect(resolveDownloadSavePath(dir, 'paper.pdf', (p) => taken.has(p))).toBe(path.join(dir, 'paper (3).pdf'))
  })

  it('falls back to a placeholder name and strips directory components', () => {
    expect(resolveDownloadSavePath(dir, '', () => false)).toBe(path.join(dir, 'download'))
    expect(resolveDownloadSavePath(dir, '..', () => false)).toBe(path.join(dir, 'download'))
    expect(resolveDownloadSavePath(dir, 'nested/paper.pdf', () => false)).toBe(path.join(dir, 'paper.pdf'))
  })

  it('keeps dotfiles intact', () => {
    expect(resolveDownloadSavePath(dir, '.hidden', () => false)).toBe(path.join(dir, '.hidden'))
  })
})
