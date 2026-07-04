import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { VersionStatusCard } from '../VersionStatusCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../CLIIcon', () => ({
  CLIIcon: ({ id }: { id: string }) => <span data-testid={`cli-icon-${id}`} />
}))

describe('VersionStatusCard', () => {
  it('keeps the install action but omits the not-installed title badge', () => {
    render(
      <VersionStatusCard
        toolId="claude-code"
        toolName="Claude Code"
        status={{ installed: false, canUpgrade: false }}
        onInstall={vi.fn()}
      />
    )

    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.queryByText('code.not_installed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code.install' })).toBeInTheDocument()
  })
})
