// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { SecretInput } from '../SecretInput'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.show_credential': 'Show localized credential',
        'common.hide_credential': 'Hide localized credential'
      })[key] ?? key
  })
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

describe('SecretInput', () => {
  it('provides localized visibility labels by default', () => {
    render(<SecretInput aria-label="Credential" />)

    expect(screen.getByRole('button', { name: 'Show localized credential' })).toBeInTheDocument()
  })
})
