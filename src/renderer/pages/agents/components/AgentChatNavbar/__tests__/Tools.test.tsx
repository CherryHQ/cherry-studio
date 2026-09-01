import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showGlobalSearch: vi.fn()
}))

vi.mock('@renderer/components/command', () => ({
  CommandTooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPopup', () => ({
  default: {
    show: mocks.showGlobalSearch
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({ 'globalSearch.open': 'Open global search' })[key] ?? key
  })
}))

import Tools from '../Tools'

describe('Agent navbar tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens global search from the agent navbar', async () => {
    const user = userEvent.setup()

    render(<Tools />)

    await user.click(screen.getByRole('button', { name: 'Open global search' }))

    expect(mocks.showGlobalSearch).toHaveBeenCalledOnce()
  })
})
