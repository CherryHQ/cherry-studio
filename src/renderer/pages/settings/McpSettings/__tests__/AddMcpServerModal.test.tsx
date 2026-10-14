import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useInvalidateCache } from '@data/hooks/useDataApi'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'

import AddMcpServerModal from '../AddMcpServerModal'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  patch: vi.fn(),
  toastError: vi.fn(),
  invalidate: vi.fn(),
  persistedIsActive: new Map<string, boolean>(),
  listSnapshots: [] as boolean[][]
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
    request: mocks.ipcRequest
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: mocks.toastError
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

const importJson = async (config: unknown) => {
  const onSuccess = vi.fn(async (dtos: CreateMcpServerDto[]) => {
    const created = toCreatedServers(dtos)
    created.forEach((server) => mocks.persistedIsActive.set(server.id, server.isActive))
    return created
  })
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
    target: { value: JSON.stringify(config) }
  })
  await user.click(screen.getByRole('button', { name: 'common.confirm' }))

  return { onSuccess, onClose }
}

const twoServerConfig = {
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
}

describe('AddMcpServerModal', () => {
  beforeEach(() => {
    mocks.persistedIsActive.clear()
    mocks.toastError.mockReset()
    mocks.ipcRequest.mockReset()
    mocks.ipcRequest.mockResolvedValue(undefined)
    mocks.listSnapshots.length = 0
    mocks.invalidate.mockReset()
    mocks.invalidate.mockImplementation(async (key: string) => {
      if (key === '/mcp-servers') mocks.listSnapshots.push([...mocks.persistedIsActive.values()])
    })
    vi.mocked(useInvalidateCache).mockReturnValue(mocks.invalidate)
    mocks.patch.mockReset()
    mocks.patch.mockImplementation(async (path: string, { body }: { body: { isActive?: boolean } }) => {
      const id = path.replace('/mcp-servers/', '')
      if (body.isActive !== undefined) mocks.persistedIsActive.set(id, body.isActive)
    })
  })

  it('imports every server from a multi-server JSON config', async () => {
    const { onSuccess, onClose } = await importJson(twoServerConfig)

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
  })

  it('leaves imported servers enabled once they connect', async () => {
    await importJson(twoServerConfig)

    await waitFor(() => expect([...mocks.persistedIsActive.values()]).toEqual([true, true]))
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.listSnapshots.at(-1)).toEqual([true, true])
  })

  it('keeps an unreachable imported server enabled and reports the failure', async () => {
    mocks.ipcRequest.mockRejectedValue(new Error('connect ECONNREFUSED'))

    await importJson({ mcpServers: { broken: { type: 'streamablehttp', baseUrl: 'https://127.0.0.1:1/mcp' } } })

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('broken' + 'settings.mcp.addServer.importFrom.connectionFailed')
    )
    expect([...mocks.persistedIsActive.values()]).toEqual([true])
  })
})
