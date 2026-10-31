import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcpContentBlock } from '../AcpContentBlock'

describe('ACP output content', () => {
  afterEach(() => vi.restoreAllMocks())
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
