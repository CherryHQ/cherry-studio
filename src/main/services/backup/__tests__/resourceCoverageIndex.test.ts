import { describe, expect, it, vi } from 'vitest'

import { ResourceCoverageIndex } from '../resourceCoverageIndex'

interface Unit {
  readonly path: string
  readonly isDirectory: boolean
}

function build(units: readonly Unit[]) {
  return ResourceCoverageIndex.build(units, (unit) => unit)
}

describe('ResourceCoverageIndex', () => {
  it('finds exact file units and descendants of directory units', () => {
    const file = { path: 'Data/Files/a', isDirectory: false }
    const directory = { path: 'Data/Notes', isDirectory: true }
    const built = build([file, directory])
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.index.covering('data/files/A')).toBe(file)
    expect(built.index.covering('Data/Notes/empty/child.md')).toBe(directory)
    expect(built.index.covering('Data/Files/a/child')).toBeNull()
    expect(built.index.covering('Data/Unknown')).toBeNull()
  })

  it('recognizes structural ancestors and directories inside a declared directory unit', () => {
    const built = build([{ path: 'resources/Data/Notes', isDirectory: true }])
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.index.isStructuralDirectory('resources')).toBe(true)
    expect(built.index.isStructuralDirectory('resources/Data')).toBe(true)
    expect(built.index.isStructuralDirectory('resources/Data/Notes/empty')).toBe(true)
    expect(built.index.isStructuralDirectory('resources/Other')).toBe(false)
  })

  it.each([
    [
      'duplicate',
      [
        { path: 'Data/Files/a', isDirectory: false },
        { path: 'data/files/A', isDirectory: false }
      ]
    ],
    [
      'overlap',
      [
        { path: 'Data/Notes', isDirectory: true },
        { path: 'Data/Notes/a.md', isDirectory: false }
      ]
    ]
  ])('rejects a %s authority set', (kind, units) => {
    const built = build(units)
    expect(built).toMatchObject({ ok: false, conflict: { kind } })
  })

  it('indexes every unit once at the supported 50k ceiling', () => {
    const units = Array.from({ length: 50_000 }, (_, index) => ({
      path: `Data/Files/blob-${index}`,
      isDirectory: false
    }))
    const describe = vi.fn((unit: Unit) => unit)
    const built = ResourceCoverageIndex.build(units, describe)
    expect(built.ok).toBe(true)
    expect(describe).toHaveBeenCalledTimes(units.length)
    if (!built.ok) return

    expect(built.index.covering('Data/Files/blob-0')).toBe(units[0])
    expect(built.index.covering('Data/Files/blob-25000')).toBe(units[25_000])
    expect(built.index.covering('Data/Files/blob-49999')).toBe(units[49_999])
  })
})
