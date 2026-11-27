import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useInvalidateCache } from '@data/hooks/useDataApi'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'

import AddMcpServerModal from '../AddMcpServerModal'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  ipcRequest: vi.fn(),
  patch: vi.fn(),
  toastError: vi.fn(),
  invalidate: vi.fn(),
  persistedIsActive: new Map<string, boolean>(),
  persistedIsTrusted: new Map<string, boolean | undefined>(),
  listSnapshots: [] as boolean[][]
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual
  }
})

vi.mock('@renderer/components/LazyCodeEditor', () => ({
  LazyCodeEditor: ({ value, onChange }: ComponentProps<'textarea'> & { onChange: (value: string) => void }) => (
    <textarea aria-label="server config" value={value} onChange={(event) => onChange(event.target.value)} />
  )
}))

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

vi.mock('@renderer/services/popup', () => ({
  popup: {
    confirm: mocks.confirm
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
    created.forEach((server) => {
      mocks.persistedIsActive.set(server.id, server.isActive)
      mocks.persistedIsTrusted.set(server.id, server.isTrusted)
    })
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
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue(true)
    mocks.persistedIsActive.clear()
    mocks.persistedIsTrusted.clear()
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
    mocks.patch.mockImplementation(
      async (path: string, { body }: { body: { isActive?: boolean; isTrusted?: boolean } }) => {
        const id = path.replace('/mcp-servers/', '')
        if (body.isActive !== undefined) mocks.persistedIsActive.set(id, body.isActive)
        if (body.isTrusted !== undefined) mocks.persistedIsTrusted.set(id, body.isTrusted)
      }
    )
  })

  it('imports JSON servers as untrusted and disabled without connecting on generic Confirm', async () => {
    let resolveConfirm!: (value: boolean) => void
    mocks.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve
        })
    )

    const { onSuccess, onClose } = await importJson(twoServerConfig)

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'pkulaw-law-search',
        type: 'streamableHttp',
        baseUrl: 'https://apim-gateway.pkulaw.com/mcp-law-search-service',
        installSource: 'manual',
        isActive: false,
        isTrusted: false
      }),
      expect.objectContaining({
        name: 'pkulaw-law-keyword',
        type: 'streamableHttp',
        baseUrl: 'https://apim-gateway.pkulaw.com/mcp-law',
        installSource: 'manual',
        isActive: false,
        isTrusted: false
      })
    ])
    for (const dto of onSuccess.mock.calls[0][0]) {
      expect(dto.trustedAt).toBeUndefined()
    }
    expect(onClose).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.mcp.importTrustWarning.title',
        okText: 'settings.mcp.importTrustWarning.confirm',
        okButtonProps: { danger: true }
      })
    )
    // Nothing is trusted or connected before explicit confirmation resolves.
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(mocks.ipcRequest).not.toHaveBeenCalled()

    // Declining trust leaves all imported servers untrusted and inactive.
    resolveConfirm(false)
    await Promise.resolve()
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    expect([...mocks.persistedIsActive.values()]).toEqual([false, false])
    expect([...mocks.persistedIsTrusted.values()]).toEqual([false, false])
  })

  it('trusts and enables imported servers only after explicit trust confirmation', async () => {
    await importJson(twoServerConfig)

    await waitFor(() => expect([...mocks.persistedIsActive.values()]).toEqual([true, true]))
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect([...mocks.persistedIsTrusted.values()]).toEqual([true, true])
    expect(mocks.patch).toHaveBeenCalledWith(
      '/mcp-servers/550e8400-e29b-41d4-a716-446655440000',
      expect.objectContaining({
        body: expect.objectContaining({ isActive: true, isTrusted: true, trustedAt: expect.any(Number) })
      })
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.listSnapshots.at(-1)).toEqual([true, true])
  })

  it('keeps an unreachable imported server enabled and reports the failure after explicit trust (#21323)', async () => {
    mocks.ipcRequest.mockRejectedValue(new Error('connect ECONNREFUSED'))

    await importJson({ mcpServers: { broken: { type: 'streamablehttp', baseUrl: 'https://127.0.0.1:1/mcp' } } })

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('broken' + 'settings.mcp.addServer.importFrom.connectionFailed')
    )
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect([...mocks.persistedIsActive.values()]).toEqual([true])
    expect([...mocks.persistedIsTrusted.values()]).toEqual([true])
  })

  it('imports MCPB packages as untrusted and waits for explicit trust before connecting', async () => {
    mocks.confirm.mockResolvedValue(false)
    mocks.ipcRequest.mockImplementation(async (channel: string) => {
      if (channel === 'mcp.package.upload_mcpb') {
        return {
          success: true,
          data: {
            extractDir: '/tmp/mcpb-test',
            manifest: {
              name: 'demo-pkg',
              display_name: 'Demo Package',
              description: 'Test package',
              server: {
                mcp_config: {
                  command: 'node',
                  args: ['${__dirname}/index.js'],
                  env: { DEMO: '1' }
                }
              }
            }
          }
        }
      }
      return undefined
    })

    const onSuccess = vi.fn(async (dtos: CreateMcpServerDto[]) => toCreatedServers(dtos))
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <AddMcpServerModal
        visible
        onClose={onClose}
        onSuccess={onSuccess}
        existingServers={[]}
        initialImportMethod="mcpb"
      />
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()
    const file = new File([new Uint8Array([1, 2, 3])], 'demo.mcpb', { type: 'application/octet-stream' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
    fireEvent.change(fileInput, { target: { files: [file] } })

    const confirmButton = screen.getByRole('button', { name: 'common.confirm' })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    await user.click(confirmButton)

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'Demo Package',
        type: 'stdio',
        command: 'node',
        installSource: 'manual',
        isActive: false,
        isTrusted: false
      })
    ])
    expect(onSuccess.mock.calls[0][0][0].trustedAt).toBeUndefined()
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('mcp.server.refresh_tools', expect.anything())
  })

  it('connects an imported MCPB package and keeps failure visible after explicit trust (#21323)', async () => {
    mocks.confirm.mockResolvedValue(true)
    mocks.ipcRequest.mockImplementation(async (channel: string) => {
      if (channel === 'mcp.package.upload_mcpb') {
        return {
          success: true,
          data: {
            extractDir: '/tmp/mcpb-test',
            manifest: {
              name: 'broken-pkg',
              display_name: 'Broken Package',
              description: 'Test package',
              server: {
                mcp_config: {
                  command: 'node',
                  args: ['${__dirname}/missing.js'],
                  env: {}
                }
              }
            }
          }
        }
      }
      if (channel === 'mcp.server.refresh_tools') {
        throw new Error('spawn ENOENT')
      }
      return undefined
    })

    const onSuccess = vi.fn(async (dtos: CreateMcpServerDto[]) => {
      const created = toCreatedServers(dtos)
      created.forEach((server) => {
        mocks.persistedIsActive.set(server.id, server.isActive)
        mocks.persistedIsTrusted.set(server.id, server.isTrusted)
      })
      return created
    })
    const user = userEvent.setup()

    render(
      <AddMcpServerModal
        visible
        onClose={vi.fn()}
        onSuccess={onSuccess}
        existingServers={[]}
        initialImportMethod="mcpb"
      />
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'broken.mcpb', { type: 'application/octet-stream' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
    fireEvent.change(fileInput, { target: { files: [file] } })

    const confirmButton = screen.getByRole('button', { name: 'common.confirm' })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    await user.click(confirmButton)

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Broken Package' + 'settings.mcp.addServer.importFrom.connectionFailed'
      )
    )
    expect([...mocks.persistedIsActive.values()]).toEqual([true])
    expect([...mocks.persistedIsTrusted.values()]).toEqual([true])
  })
})
