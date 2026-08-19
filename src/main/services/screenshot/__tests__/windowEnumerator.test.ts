import { readWindowInfo } from '@main/services/screenshot/windowEnumerator'
import { describe, expect, it } from 'vitest'

const makeWindow = (over: Partial<Record<string, unknown>> = {}) => ({
  pid: () => 1,
  title: () => 'A',
  x: () => 10,
  y: () => 20,
  width: () => 30,
  height: () => 40,
  isMinimized: () => false,
  ...over
})

describe('readWindowInfo', () => {
  it('skips a window that disappears between the enumeration and a property read', () => {
    // Menus and tooltips close constantly, so a throwing accessor must cost that one
    // window, not the whole hit-test list.
    const dying = makeWindow({
      title: () => {
        throw new Error('window closed')
      }
    })

    expect(readWindowInfo(dying)).toBeNull()
  })

  it('reads exactly the fields a snap target needs', () => {
    // Each accessor re-queries the whole OS window list, so an unused field is
    // ~30ms of native work per capture on a normal working set.
    expect(readWindowInfo(makeWindow())).toEqual({
      pid: 1,
      title: 'A',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      isMinimized: false
    })
  })
})
