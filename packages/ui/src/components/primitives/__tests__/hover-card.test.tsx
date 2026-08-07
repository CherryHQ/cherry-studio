// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '../hover-card'

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

describe('HoverCard', () => {
  it('renders controlled hover card content', () => {
    render(
      <HoverCard open>
        <HoverCardTrigger asChild>
          <button type="button">Usage row</button>
        </HoverCardTrigger>
        <HoverCardContent>Usage details</HoverCardContent>
      </HoverCard>
    )

    expect(screen.getByText('Usage row')).toBeInTheDocument()
    expect(screen.getByText('Usage details')).toBeInTheDocument()
  })
})
