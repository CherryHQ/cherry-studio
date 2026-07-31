import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import McpProtocolInstallDialog from '../McpProtocolInstallDialog'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

const servers: CreateMcpServerDto[] = [
  {
    name: 'stdio-preview',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'example-server'],
    installSource: 'protocol',
    isActive: false,
    isTrusted: false
  },
  {
    name: 'http-preview',
    type: 'streamableHttp',
    baseUrl: 'https://example.com/mcp',
    installSource: 'protocol',
    isActive: false,
    isTrusted: false
  }
]

describe('McpProtocolInstallDialog', () => {
  it('previews every server and installs only after confirmation', async () => {
    const onInstall = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<McpProtocolInstallDialog open servers={servers} onOpenChange={vi.fn()} onInstall={onInstall} />)

    expect(screen.getByText('stdio-preview')).toBeInTheDocument()
    expect(screen.getByText('npx -y example-server')).toBeInTheDocument()
    expect(screen.getByText('http-preview')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/mcp')).toBeInTheDocument()
    expect(onInstall).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'settings.mcp.install' }))

    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it('closes without installing when canceled', async () => {
    const onInstall = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(<McpProtocolInstallDialog open servers={servers} onOpenChange={onOpenChange} onInstall={onInstall} />)

    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onInstall).not.toHaveBeenCalled()
  })
})
