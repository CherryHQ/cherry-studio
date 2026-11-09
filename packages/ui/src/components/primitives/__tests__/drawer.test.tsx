// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, it, expect } from 'vitest'

import { Drawer, DrawerContent, DrawerTitle } from '../drawer'

afterEach(cleanup)

// Losing Vaul's direction attribute removes the modal drawer's positioning and animation styles.
it.each([true, false])('preserves direction-based positioning with modal=%s', (modal) => {
  render(
    <Drawer open modal={modal} direction="left">
      <DrawerContent aria-describedby={undefined}>
        <DrawerTitle>Panel</DrawerTitle>
      </DrawerContent>
    </Drawer>
  )
  expect(screen.getByRole('dialog')).toHaveAttribute('data-vaul-drawer-direction', 'left')
})
