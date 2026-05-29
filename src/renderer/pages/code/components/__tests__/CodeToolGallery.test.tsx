import '@testing-library/jest-dom/vitest'

import { codeCLI } from '@shared/config/constant'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodeToolGallery } from '../CodeToolGallery'

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  return {
    Alert: ({
      action,
      className,
      message
    }: {
      action?: React.ReactNode
      className?: string
      message?: React.ReactNode
    }) => React.createElement('div', { role: 'status', className }, React.createElement('span', null, message), action),
    Button: ({ children, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement('button', { type: 'button', disabled, ...props }, children),
    EmptyState: ({ title, description }: { title?: React.ReactNode; description?: React.ReactNode }) =>
      React.createElement('div', null, title, description)
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../CodeHeroIllustrationIcon', () => ({
  CodeHeroIllustrationIcon: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="hero-code-illustration" {...props} />
  )
}))

const claudeTool = {
  value: codeCLI.claudeCode,
  label: 'Claude Code',
  icon: () => <span />
} as const

const codexTool = {
  value: codeCLI.openaiCodex,
  label: 'OpenAI Codex',
  icon: () => <span />
} as const

function renderGallery(overrides: Partial<React.ComponentProps<typeof CodeToolGallery>> = {}) {
  return render(
    <CodeToolGallery
      tools={[claudeTool, codexTool]}
      isBunInstalled={false}
      isInstallingBun={false}
      handleInstallBun={vi.fn()}
      activeToolValue={undefined}
      handleSelectTool={vi.fn()}
      toMeta={(item) => ({ id: item.value, label: item.label, icon: item.icon })}
      {...overrides}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CodeToolGallery', () => {
  it('renders the hero illustration and Bun requirement prompt', () => {
    renderGallery({ tools: [claudeTool] })

    expect(screen.getByTestId('hero-code-illustration')).toBeInTheDocument()
    expect(screen.getByText('code.hero_tagline')).toBeInTheDocument()
    expect(screen.getByText('code.bun_required_message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code.install_bun' })).toBeInTheDocument()
  })

  it('hides the Bun requirement prompt once Bun is installed', () => {
    renderGallery({ tools: [claudeTool], isBunInstalled: true })

    expect(screen.queryByText('code.bun_required_message')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code.install_bun' })).not.toBeInTheDocument()
  })

  it('invokes handleSelectTool with the clicked tool value', () => {
    const handleSelectTool = vi.fn()
    renderGallery({ handleSelectTool })

    fireEvent.click(screen.getByText('Claude Code'))
    expect(handleSelectTool).toHaveBeenCalledTimes(1)
    expect(handleSelectTool).toHaveBeenCalledWith(claudeTool.value)
  })

  it('marks the active tool card as selected via data-selected', () => {
    renderGallery({ activeToolValue: codexTool.value })

    const claudeCard = screen.getByText('Claude Code').closest('button')
    const codexCard = screen.getByText('OpenAI Codex').closest('button')

    expect(claudeCard).not.toHaveAttribute('data-selected')
    expect(codexCard).toHaveAttribute('data-selected', 'true')
  })

  it('fires handleInstallBun when the install button is clicked', () => {
    const handleInstallBun = vi.fn()
    renderGallery({ handleInstallBun })

    fireEvent.click(screen.getByRole('button', { name: 'code.install_bun' }))
    expect(handleInstallBun).toHaveBeenCalledTimes(1)
  })

  it('disables the install button and shows the installing label while installing', () => {
    renderGallery({ isInstallingBun: true })

    const button = screen.getByRole('button', { name: 'code.installing_bun' })
    expect(button).toBeDisabled()
  })
})
