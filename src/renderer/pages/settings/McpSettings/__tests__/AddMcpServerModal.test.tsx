import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import AddMcpServerModal from '../AddMcpServerModal'

const mocks = vi.hoisted(() => ({
  checkConnectivity: vi.fn().mockResolvedValue(false),
  patch: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    CodeEditor: ({ value, onChange }: ComponentProps<'textarea'> & { onChange: (value: string) => void }) => (
      <textarea aria-label="server config" value={value} onChange={(event) => onChange(event.target.value)} />
    )
  }
})

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    patch: mocks.patch
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [14]
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' }),
  useCmTheme: () => 'light'
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.checkConnectivity
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const toCreatedServers = (dtos: CreateMcpServerDto[]): McpServer[] =>
  dtos.map((dto, index) => ({
    ...dto,
    id: `550e8400-e29b-41d4-a716-44665544000${index}`,
    isActive: false
  }))

describe('AddMcpServerModal', () => {
  it('imports every server from a multi-server JSON config', async () => {
    const onSuccess = vi.fn(async (dtos: CreateMcpServerDto[]) => toCreatedServers(dtos))
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <AddMcpServerModal
        visible
        onClose={onClose}
        onSuccess={onSuccess}
        existingServers={[]}
        initialImportMethod="json"
      />
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'server config' }), {
      target: {
        value: JSON.stringify({
          mcpServers: {
            'pkulaw-law-search': {
              type: 'streamablehttp',
              baseUrl: 'https://apim-gateway.pkulaw.com/mcp-law-search-service',
              headers: { Authorization: 'Bearer token' }
            },
            'pkulaw-law-keyword': {
              type: 'streamablehttp',
              baseUrl: 'https://apim-gateway.pkulaw.com/mcp-law',
              headers: { Authorization: 'Bearer token' }
            }
          }
        })
      }
    })
    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'pkulaw-law-search',
        type: 'streamableHttp',
        baseUrl: 'https://apim-gateway.pkulaw.com/mcp-law-search-service'
      }),
      expect.objectContaining({
        name: 'pkulaw-law-keyword',
        type: 'streamableHttp',
        baseUrl: 'https://apim-gateway.pkulaw.com/mcp-law'
      })
    ])
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mocks.checkConnectivity).toHaveBeenCalledTimes(2))
  })
})
