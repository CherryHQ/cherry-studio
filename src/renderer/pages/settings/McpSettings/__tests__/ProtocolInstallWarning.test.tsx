import type { McpServer } from '@shared/data/types/mcpServer'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { getTransportCandidates } from '../../../../../main/ai/mcp/mcpClientSdk'
import { resolveMcpConfigTransportType } from '../McpServerFields'
import { McpServerConfigPreview } from '../ProtocolInstallWarning'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

const whitespaceUrlServer = {
  id: 'legacy-command-server',
  name: 'Legacy server',
  type: 'sse',
  baseUrl: '   ',
  command: 'npx',
  args: ['-y', 'legacy-server'],
  isActive: true
} as McpServer

describe('McpServerConfigPreview', () => {
  it('treats a whitespace-only baseUrl as a command, matching settings and runtime checks', () => {
    render(<McpServerConfigPreview server={whitespaceUrlServer} />)

    expect(screen.getByText('settings.mcp.command')).toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.url')).not.toBeInTheDocument()
    expect(screen.getByText('npx -y legacy-server')).toBeInTheDocument()
    expect(resolveMcpConfigTransportType('sse', whitespaceUrlServer.name, whitespaceUrlServer.command, '   ')).toBe(
      'stdio'
    )
    expect(getTransportCandidates(whitespaceUrlServer)).toBeNull()
  })

  it('keeps a real URL as the launch preview after trimming surrounding whitespace', () => {
    render(
      <McpServerConfigPreview
        server={{
          baseUrl: '  https://example.com/mcp  ',
          command: 'npx'
        }}
      />
    )

    expect(screen.getByText('settings.mcp.url')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/mcp')).toBeInTheDocument()
    expect(screen.queryByText('npx')).not.toBeInTheDocument()
  })
})
