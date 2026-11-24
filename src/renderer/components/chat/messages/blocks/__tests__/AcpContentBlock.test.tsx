import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '../../types'
import { AcpContentBlock } from '../AcpContentBlock'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

describe('ACP output content', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders file links and local paths inside text blocks as clickable links', async () => {
    const user = userEvent.setup()
    const openPath = vi.fn()
    const value: MessageListProviderValue = {
      state: {
        topic: { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic'],
        messages: [],
        partsByMessageId: {},
        messageNavigation: 'none',
        estimateSize: 0,
        overscan: 0,
        loadOlderDelayMs: 0,
        loadingResetDelayMs: 0,
        renderConfig: defaultMessageRenderConfig
      },
      actions: { openPath },
      meta: { selectionLayer: false }
    }

    render(
      <MessageListProvider value={value}>
        <AcpContentBlock
          content={{
            type: 'text',
            text: 'Created [pelican-bicycle.html](file:///tmp/pelican-bicycle.html), `src/app.ts`, and /tmp/dist/out.js'
          }}
        />
      </MessageListProvider>
    )

    await user.click(screen.getByRole('link', { name: 'pelican-bicycle.html' }))
    expect(openPath).toHaveBeenCalledWith('/tmp/pelican-bicycle.html')

    const inlineCodeLink = await screen.findByRole('link', { name: 'src/app.ts' })
    await user.click(inlineCodeLink)
    expect(openPath).toHaveBeenCalledWith('src/app.ts')

    const bareAnchoredLink = await screen.findByRole('link', { name: '/tmp/dist/out.js' })
    await user.click(bareAnchoredLink)
    expect(openPath).toHaveBeenCalledWith('/tmp/dist/out.js')
  })
  it('displays embedded text verbatim and keeps unsafe resource URIs inert', () => {
    render(
      <AcpContentBlock
        content={{ type: 'resource', resource: { uri: 'javascript:alert(1)', text: '<script>example</script>' } }}
      />
    )
    expect(screen.getByText('<script>example</script>')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })

  it('keeps binary payloads downloadable without rendering them as executable documents', () => {
    render(
      <AcpContentBlock
        content={{
          type: 'resource',
          resource: { uri: 'file:///tmp/report.html', mimeType: 'text/html', blob: 'aGVsbG8=' }
        }}
      />
    )
    const download = document.querySelector('a[download]')
    expect(download).toHaveAttribute('download', 'report.html')
    expect(download).toHaveAttribute('href', 'data:application/octet-stream;base64,aGVsbG8=')
  })

  it('provides playable blob audio without autoplay and releases it on unmount', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const { unmount } = render(<AcpContentBlock content={{ type: 'audio', mimeType: 'audio/wav', data: 'YXVkaW8=' }} />)
    const audio = document.querySelector('audio')
    expect(audio).toHaveAttribute('src', 'blob:audio')
    expect(create.mock.calls[0][0]).toMatchObject({ type: 'audio/wav', size: 5 })
    expect(audio).toHaveAttribute('controls')
    expect(audio).not.toHaveAttribute('autoplay')
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:audio')
  })
})
