import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/hooks/resourceCatalog/assistantAdapter', () => ({
  useAssistantMutations: () => ({ createAssistant: vi.fn() })
}))

vi.mock('@renderer/hooks/useTags', () => ({
  useEnsureTags: () => ({ ensureTags: vi.fn() })
}))

import { ImportAssistantDialog } from '../ImportAssistantDialog'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
})

afterEach(cleanup)

describe('ImportAssistantDialog overlay close', () => {
  it('uses the shared dialog width instead of a narrower override', () => {
    render(<ImportAssistantDialog open onOpenChange={vi.fn()} />)

    const content = document.querySelector('[data-slot="dialog-content"]')
    expect(content).toHaveClass('overflow-hidden')
    expect(content).not.toHaveClass('sm:max-w-md')
  })

  it('closes when clicking the overlay while idle', () => {
    const onOpenChange = vi.fn()

    render(<ImportAssistantDialog open onOpenChange={onOpenChange} />)

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
