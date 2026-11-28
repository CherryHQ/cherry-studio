import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type * as AppErrorDetailService from '@renderer/services/AppErrorDetailService'

const { openErrorDetail, request } = vi.hoisted(() => ({
  openErrorDetail: vi.fn().mockResolvedValue('opened'),
  request: vi.fn()
}))
vi.mock('@renderer/services/AppErrorDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof AppErrorDetailService>()),
  appErrorDetailService: { openAppErrorDetail: openErrorDetail }
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request, on: () => () => undefined } }))

import McpResourcePreview from '../McpResourcePreview'

describe('MCP resource preview', () => {
  it('keeps a signed resource URI query out of the reported preview failure', async () => {
    const uri = 'https://files.example.invalid/report.pdf?X-Amz-Signature=sig-4f9a2c7e81&X-Amz-Expires=300'
    request.mockImplementation((route: string) =>
      route === 'mcp.server.read_resource_preview'
        ? Promise.reject(new Error(`Resource ${uri} not found`))
        : Promise.resolve(undefined)
    )

    render(<McpResourcePreview serverId="docs" uri={uri} />)
    await userEvent.click(await screen.findByRole('button', { name: i18n.t('common.detail') }))

    await waitFor(() => expect(openErrorDetail).toHaveBeenCalledTimes(1))
    const report = JSON.stringify(openErrorDetail.mock.calls[0][0])
    expect(report).not.toContain('sig-4f9a2c7e81')
    expect(report).toContain('https://files.example.invalid/report.pdf')
  })
})
