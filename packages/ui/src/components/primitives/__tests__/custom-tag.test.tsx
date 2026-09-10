// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import CustomTag from '../custom-tag'

describe('CustomTag', () => {
  it('lets the destructive foreground token control close-action contrast on hover', () => {
    const { container } = render(
      <CustomTag closable color="#2563eb">
        Blue
      </CustomTag>
    )

    // The close surface has no semantic query; its token must not lose to an inline color.
    const closeAction = container.querySelector<SVGElement>('.lucide-x')?.parentElement
    expect(closeAction).toHaveClass('hover:text-destructive-foreground')
    expect(closeAction?.style.color).toBe('')
  })
})
