import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { MAX_MCP_PACKAGE_BYTES } from '@shared/types/mcp'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddMcpServerModal from '../AddMcpServerModal'

const mocks = vi.hoisted(() => ({
  checkConnectivity: vi.fn().mockResolvedValue(false),
  patch: vi.fn().mockResolvedValue(undefined),
  toastError: vi.fn(),
  uploadDxt: vi.fn(),
  uploadMcpb: vi.fn()
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

function getPackageInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('Expected the package dropzone file input')
  return input
}

describe('AddMcpServerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.mcp = {
      uploadDxt: mocks.uploadDxt,
      uploadMcpb: mocks.uploadMcpb
    }
  })

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

  it('rejects an oversized MCP package before reading or sending its bytes', async () => {
    const onSuccess = vi.fn(async (dtos: CreateMcpServerDto[]) => toCreatedServers(dtos))
    const packageFile = new File(['x'], 'oversized.dxt', { type: 'application/octet-stream' })
    const arrayBuffer = vi.fn()
    Object.defineProperties(packageFile, {
      size: { value: MAX_MCP_PACKAGE_BYTES + 1 },
      arrayBuffer: { value: arrayBuffer }
    })

    render(
      <AddMcpServerModal
        visible
        onClose={vi.fn()}
        onSuccess={onSuccess}
        existingServers={[]}
        initialImportMethod="dxt"
      />
    )

    await userEvent.upload(getPackageInput(), packageFile)
    await userEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(mocks.toastError).toHaveBeenCalledWith('settings.mcp.addServer.importFrom.packageTooLarge')
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(mocks.checkConnectivity).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('keeps a package with the wrong extension outside the upload flow', async () => {
    const packageFile = new File(['package'], 'server.zip', { type: 'application/zip' })

    render(
      <AddMcpServerModal visible onClose={vi.fn()} onSuccess={vi.fn()} existingServers={[]} initialImportMethod="dxt" />
    )

    await userEvent.upload(getPackageInput(), packageFile)

    expect(screen.getByRole('button', { name: 'common.confirm' })).toBeDisabled()
    expect(mocks.uploadDxt).not.toHaveBeenCalled()
    expect(mocks.uploadMcpb).not.toHaveBeenCalled()
    expect(mocks.checkConnectivity).not.toHaveBeenCalled()
  })

  it('passes an accepted package File through the privileged preload upload capability', async () => {
    const onSuccess = vi.fn(async (dtos: CreateMcpServerDto[]) => toCreatedServers(dtos))
    const packageFile = new File(['package'], 'server.dxt', { type: 'application/octet-stream' })
    const arrayBuffer = vi.fn()
    Object.defineProperty(packageFile, 'arrayBuffer', { value: arrayBuffer })
    mocks.uploadDxt.mockResolvedValueOnce({ success: false, error: 'test stop' })

    render(
      <AddMcpServerModal
        visible
        onClose={vi.fn()}
        onSuccess={onSuccess}
        existingServers={[]}
        initialImportMethod="dxt"
      />
    )

    await userEvent.upload(getPackageInput(), packageFile)
    await userEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(mocks.uploadDxt).toHaveBeenCalledWith(packageFile))
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('reports an empty MCP package without reading or sending it', async () => {
    const onSuccess = vi.fn(async (dtos: CreateMcpServerDto[]) => toCreatedServers(dtos))
    const packageFile = new File([], 'empty.mcpb', { type: 'application/octet-stream' })
    const arrayBuffer = vi.fn()
    Object.defineProperty(packageFile, 'arrayBuffer', { value: arrayBuffer })

    render(
      <AddMcpServerModal
        visible
        onClose={vi.fn()}
        onSuccess={onSuccess}
        existingServers={[]}
        initialImportMethod="mcpb"
      />
    )

    await userEvent.upload(getPackageInput(), packageFile)
    await userEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(mocks.toastError).toHaveBeenCalledWith('settings.mcp.addServer.importFrom.packageEmpty')
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(mocks.uploadMcpb).not.toHaveBeenCalled()
    expect(mocks.checkConnectivity).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
