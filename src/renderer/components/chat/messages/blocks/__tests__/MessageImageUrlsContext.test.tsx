import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

const ipcRequest = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest } }))

import { MessageImageUrlsProvider, useResolvedMessageImageParts } from '../MessageImageUrlsContext'

function managedImage(entryId: string, url: string): CherryMessagePart {
  return {
    type: 'file',
    url,
    mediaType: 'image/png',
    filename: `${entryId}.png`,
    providerMetadata: { cherry: { fileEntryId: entryId } }
  } as unknown as CherryMessagePart
}

function Probe({ parts }: { parts: CherryMessagePart[] }) {
  const resolved = useResolvedMessageImageParts(parts)
  const urls = resolved.flatMap((part) => (part.type === 'file' && part.url ? [part.url] : []))
  return <output data-testid="urls">{JSON.stringify(urls)}</output>
}

function Harness({ parts }: { parts: CherryMessagePart[] }) {
  return (
    <MessageImageUrlsProvider parts={parts}>
      <Probe parts={parts} />
    </MessageImageUrlsProvider>
  )
}

describe('MessageImageUrlsProvider', () => {
  it('preserves unmanaged external and data URLs while hiding a missing managed entry', async () => {
    ipcRequest.mockResolvedValue({})
    const parts = [
      managedImage('missing', 'file:///old/missing.png'),
      { type: 'file', url: 'https://example.com/image.png', mediaType: 'image/png' },
      { type: 'file', url: 'data:image/png;base64,AA==', mediaType: 'image/png' }
    ] as CherryMessagePart[]

    render(<Harness parts={parts} />)

    await waitFor(() =>
      expect(screen.getByTestId('urls')).toHaveTextContent(
        JSON.stringify(['https://example.com/image.png', 'data:image/png;base64,AA=='])
      )
    )
  })

  it('ignores an older lookup that resolves after the message parts change', async () => {
    let resolveFirst!: (paths: Record<string, string>) => void
    let resolveSecond!: (paths: Record<string, string>) => void
    ipcRequest
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)))

    const first = [managedImage('first', 'file:///old/first.png')]
    const second = [managedImage('second', 'file:///old/second.png')]
    const { rerender } = render(<Harness parts={first} />)
    rerender(<Harness parts={second} />)

    await act(async () => resolveSecond({ second: '/current/second.png' }))
    expect(screen.getByTestId('urls')).toHaveTextContent('["file:///current/second.png"]')

    await act(async () => resolveFirst({ first: '/current/first.png' }))
    expect(screen.getByTestId('urls')).toHaveTextContent('["file:///current/second.png"]')
  })
})
