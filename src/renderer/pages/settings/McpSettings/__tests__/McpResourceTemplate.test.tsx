import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type * as AppErrorDetailService from '@renderer/services/AppErrorDetailService'

const { openErrorDetail } = vi.hoisted(() => ({ openErrorDetail: vi.fn().mockResolvedValue('opened') }))
vi.mock('@renderer/services/AppErrorDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof AppErrorDetailService>()),
  appErrorDetailService: { openAppErrorDetail: openErrorDetail }
}))
vi.mock('../McpResourcePreview', () => ({ default: () => null }))

import McpResourceTemplate from '../McpResourceTemplate'

describe('MCP resource template', () => {
  it('keeps a malformed template URI out of the reported parse failure', async () => {
    render(
      <McpResourceTemplate
        template={{
          serverId: 'docs',
          serverName: 'Documents',
          name: 'files',
          uriTemplate: 'https://example.invalid/files?token=private-demo-token{broken'
        }}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: i18n.t('common.detail') }))

    await waitFor(() => expect(openErrorDetail).toHaveBeenCalledTimes(1))
    const [request] = openErrorDetail.mock.calls[0]
    expect(request.context.recordId).toBe('docs:files')
    expect(JSON.stringify(request.context)).not.toContain('private-demo-token')
  })
})
