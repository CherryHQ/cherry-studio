import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ProtocolMcpServerInstall } from '@shared/data/types/mcpProtocolInstall'

import McpProtocolInstallDialog from '../McpProtocolInstallDialog'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

const servers: ProtocolMcpServerInstall[] = [
  {
    name: 'stdio-preview',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'example-server'],
    env: { API_KEY: 'secret' },
    installSource: 'protocol',
    isActive: false,
    isTrusted: false,
    installedAt: 1
  },
  {
    name: 'http-preview',
    type: 'streamableHttp',
    baseUrl: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer token' },
    installSource: 'protocol',
    isActive: false,
    isTrusted: false,
    installedAt: 2
  }
]

describe('McpProtocolInstallDialog', () => {
  it('previews every server and installs only after confirmation', async () => {
    const onInstall = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<McpProtocolInstallDialog servers={servers} onClose={vi.fn()} onInstall={onInstall} />)

    expect(screen.getByRole('heading', { name: 'settings.mcp.protocolInstall.title' })).toBeInTheDocument()
    expect(screen.getByText('stdio-preview')).toBeInTheDocument()
    expect(screen.getByText('npx -y example-server')).toBeInTheDocument()
    expect(screen.getByText('API_KEY=secret')).toBeInTheDocument()
    expect(screen.getByText('http-preview')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/mcp')).toBeInTheDocument()
    expect(screen.getByText('Authorization: Bearer token')).toBeInTheDocument()
    expect(onInstall).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'settings.mcp.install' }))

    expect(onInstall).toHaveBeenCalledTimes(1)
  })
})
