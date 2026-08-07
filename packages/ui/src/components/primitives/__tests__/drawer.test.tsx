// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { DirectionProvider } from '@cherrystudio/ui/components/primitives/direction'
import { cleanup, render } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Drawer } from '../drawer'

const drawerRootSnapshot = vi.hoisted(() => ({
  direction: undefined as string | undefined
}))

vi.mock('vaul', async () => {
  const ReactActual = await vi.importActual<typeof React>('react')

  return {
    Drawer: {
      Root: ({ children, direction }: { children?: React.ReactNode; direction?: string }) => {
        drawerRootSnapshot.direction = direction
        return ReactActual.createElement(ReactActual.Fragment, null, children)
      }
    }
  }
})

afterEach(() => {
  cleanup()
  drawerRootSnapshot.direction = undefined
})

describe('Drawer logical side', () => {
  it('maps inline end to the physical right in LTR', () => {
    render(
      <DirectionProvider dir="ltr">
        <Drawer side="end" />
      </DirectionProvider>
    )
    expect(drawerRootSnapshot.direction).toBe('right')
  })

  it('maps inline end to the physical left in RTL', () => {
    render(
      <DirectionProvider dir="rtl">
        <Drawer side="end" />
      </DirectionProvider>
    )
    expect(drawerRootSnapshot.direction).toBe('left')
  })
})
