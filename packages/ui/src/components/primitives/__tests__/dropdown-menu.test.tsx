// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../dropdown-menu'
import { PortalContainerProvider } from '../portal-container'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

afterEach(() => {
  cleanup()
})

describe('DropdownMenuContent', () => {
  it('uses the provider portal container by default', () => {
    const portalContainer = document.createElement('div')
    document.body.appendChild(portalContainer)

    try {
      render(
        <PortalContainerProvider container={portalContainer}>
          <DropdownMenu open>
            <DropdownMenuTrigger>Open</DropdownMenuTrigger>
            <DropdownMenuContent data-testid="content">
              <DropdownMenuItem>Alpha</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PortalContainerProvider>
      )

      expect(portalContainer).toContainElement(screen.getByTestId('content'))
    } finally {
      portalContainer.remove()
    }
  })

  it('lets callers override the provider portal container', () => {
    const pagePortalContainer = document.createElement('div')
    const portalContainer = document.createElement('div')
    document.body.append(pagePortalContainer, portalContainer)

    try {
      render(
        <PortalContainerProvider container={pagePortalContainer}>
          <DropdownMenu open>
            <DropdownMenuTrigger>Open</DropdownMenuTrigger>
            <DropdownMenuContent portalContainer={portalContainer} data-testid="content">
              <DropdownMenuItem>Alpha</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PortalContainerProvider>
      )

      expect(portalContainer).toContainElement(screen.getByTestId('content'))
      expect(pagePortalContainer).not.toContainElement(screen.getByTestId('content'))
    } finally {
      pagePortalContainer.remove()
      portalContainer.remove()
    }
  })
})
