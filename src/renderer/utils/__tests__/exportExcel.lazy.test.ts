// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => vi.fn())

vi.mock('@e965/xlsx', () => {
  loaded()
  return {
    utils: {
      aoa_to_sheet: vi.fn(() => ({})),
      book_append_sheet: vi.fn(),
      book_new: vi.fn(() => ({}))
    },
    write: vi.fn(() => [1, 2, 3])
  }
})

describe('exportExcel lazy boundary', () => {
  it('does not load @e965/xlsx until an export is performed', async () => {
    const { exportTableToExcel } = await import('../exportExcel')
    expect(loaded).not.toHaveBeenCalled()

    // Cancelled folder picker still exercises the xlsx workbook-building path.
    Object.assign(window, {
      api: {
        ...window.api,
        file: {
          ...window.api?.file,
          selectFolder: vi.fn(async () => null),
          write: vi.fn()
        }
      }
    })
    await exportTableToExcel('| a |\n|---|\n| b |')

    expect(loaded).toHaveBeenCalledTimes(1)
  })
})
