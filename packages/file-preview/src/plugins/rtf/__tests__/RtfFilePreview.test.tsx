import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Preview } from '../../../Preview'
import type { PreviewDocument, PreviewSource } from '../../../source'

vi.unmock('@cherrystudio/ui')

afterEach(cleanup)

function source(rtf: string, name = 'report.rtf', overrides: Partial<PreviewDocument> = {}): PreviewSource {
  const bytes = new TextEncoder().encode(rtf)
  return {
    id: name,
    name,
    open: async () => ({
      size: bytes.byteLength,
      revision: 'v1',
      readRange: async (offset, length) => bytes.subarray(offset, offset + length),
      close: async () => {},
      ...overrides
    })
  }
}

describe('RTF preview', () => {
  it('renders formatted Unicode and legacy encoded text instead of RTF source', async () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252\uc1 Plain {\b Bold} {\i Italic}\par Caf\'e9 \u20013?\u25991? \u-10179?\u-8704?}`
    const bytes = new TextEncoder().encode(`padding${rtf}trailer`)
    render(
      <Preview
        source={source(rtf, 'REPORT.RTF', {
          readRange: async () => bytes.subarray(7, 7 + rtf.length)
        })}
      />
    )

    const body = await screen.findByRole('document', { name: 'REPORT.RTF' })
    expect(body).toHaveTextContent('Café 中文 😀')
    // Bold and italic are document content, not incidental preview UI styling.
    expect(within(body).getByText('Bold')).toHaveStyle({ fontWeight: 'bold' })
    expect(within(body).getByText('Italic')).toHaveStyle({ fontStyle: 'italic' })
    expect(body).not.toHaveTextContent('\\rtf1')
  })

  it('decodes raw Chinese bytes, including trail bytes that look like RTF syntax', async () => {
    const prefix = new TextEncoder().encode(String.raw`{\rtf1\ansi\ansicpg936 `)
    const bytes = new Uint8Array([...prefix, 0xd6, 0xd0, 0xce, 0xc4, 0x81, 0x5c, 0x7d])
    render(<Preview source={source('', 'chinese.rtf', { size: bytes.length, readRange: async () => bytes })} />)

    expect(await screen.findByRole('document')).toHaveTextContent('中文乗')
  })

  it('decodes hexadecimal bytes using the active font code page', async () => {
    render(
      <Preview
        source={source(
          String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fnil\fcharset134 SimSun;}}\f0 \'d6\'d0\'ce\'c4}`
        )}
      />
    )

    expect(await screen.findByRole('document')).toHaveTextContent('中文')
  })

  it.each([0, 7])('restores default font %s and its encoding after character resets', async (defaultFont) => {
    const header = String.raw`{\rtf1\ansi\ansicpg1252\deff${defaultFont}{\fonttbl{\f${defaultFont}\fnil\fcharset134 SimSun;}{\f1\fnil\fcharset0 Arial;}}`
    const prefix = new TextEncoder().encode(header + String.raw`\f${defaultFont}\b Bold\plain `)
    const suffix = new TextEncoder().encode(String.raw` {\f1 Caf\'e9 \plain \'d6\'d0\'ce\'c4} \'d6\'d0\'ce\'c4}`)
    const bytes = new Uint8Array([...prefix, 0xd6, 0xd0, 0xce, 0xc4, ...suffix])
    render(<Preview source={source('', 'default-font.rtf', { size: bytes.length, readRange: async () => bytes })} />)

    const body = await screen.findByRole('document')
    expect(body).toHaveTextContent('Bold中文 Café 中文 中文')
    expect(within(body).getByText('Bold')).toHaveStyle({ fontWeight: 'bold' })
    for (const text of within(body).getAllByText('中文')) {
      expect(text).toHaveStyle({ fontFamily: 'SimSun' })
      expect(text).not.toHaveStyle({ fontWeight: 'bold' })
    }
  })

  describe.each([
    { codepage: 936, charset: 134, lead: 0x81, trail: 0x41, expected: '丄' },
    { codepage: 950, charset: 136, lead: 0xa7, trail: 0x41, expected: '你' },
    { codepage: 932, charset: 128, lead: 0x8a, trail: 0x45, expected: '界' }
  ])('code page $codepage byte representations', ({ codepage, charset, lead, trail, expected }) => {
    const escapedLead = String.raw`\'${lead.toString(16)}`
    const representations = [
      { name: 'raw pair', encoded: String.fromCharCode(lead, trail) },
      { name: 'hex pair', encoded: escapedLead + String.raw`\'${trail.toString(16)}` },
      { name: 'hex lead and literal trail', encoded: escapedLead + String.fromCharCode(trail) }
    ]

    it.each(representations)('decodes $name using the document code page', async ({ encoded }) => {
      const rtf = String.raw`{\rtf1\ansi\ansicpg${codepage} Start ${encoded} End}`
      const bytes = Uint8Array.from(rtf, (character) => character.charCodeAt(0))
      render(<Preview source={source('', 'encoding.rtf', { size: bytes.length, readRange: async () => bytes })} />)

      expect(await screen.findByRole('document')).toHaveTextContent(`Start ${expected} End`)
    })

    it.each(representations)('decodes $name across font switches, resets and groups', async ({ encoded }) => {
      const rtf = String.raw`{\rtf1\ansi\ansicpg1252\deff7{\fonttbl{\f7\fnil\fcharset${charset} CJK;}{\f1\fnil\fcharset0 Arial;}}\f7 ${encoded} {\f1 Caf\'e9 \plain ${encoded}} ${encoded}}`
      const bytes = Uint8Array.from(rtf, (character) => character.charCodeAt(0))
      render(<Preview source={source('', 'fonts.rtf', { size: bytes.length, readRange: async () => bytes })} />)

      expect(await screen.findByRole('document')).toHaveTextContent(`${expected} Café ${expected} ${expected}`)
    })
  })

  it.each([
    { codepage: 936, encoded: String.raw`\'81\\ \'81\{ \'81\}`, expected: '乗 亄 亇' },
    { codepage: 950, encoded: String.raw`\'a4\\ \'a4\{`, expected: '么 廾' },
    { codepage: 932, encoded: String.raw`\'95\\`, expected: '表' },
    { codepage: 1252, encoded: String.raw`\\ \{ \} Caf\'e9`, expected: '\\ { } Café' }
  ])('decodes escaped literal symbols under code page $codepage', async ({ codepage, encoded, expected }) => {
    render(<Preview source={source(String.raw`{\rtf1\ansi\ansicpg${codepage} ${encoded}}`)} />)

    expect(await screen.findByRole('document')).toHaveTextContent(expected)
  })

  it('keeps Unicode and its skipped fallback bytes separate from legacy byte runs', async () => {
    render(<Preview source={source(String.raw`{\rtf1\ansi\ansicpg950 \'a7A \uc2\u20320\'a7A \uc1\u30028? \'a7A}`)} />)

    expect(await screen.findByRole('document')).toHaveTextContent('你 你 界 你')
  })

  it('skips escaped literal Unicode fallbacks without leaking them into the text', async () => {
    render(<Preview source={source(String.raw`{\rtf1\ansi\ansicpg950 \uc1\u20320\{ \'a7A}`)} />)

    expect(await screen.findByRole('document')).toHaveTextContent('你 你')
  })

  it.each(['loch', 'hich', 'dbch'])('uses the code page for byte decoding with the %s font hint', async (hint) => {
    render(<Preview source={source(String.raw`{\rtf1\ansi\ansicpg950 ` + `\\${hint} ` + String.raw`\'a7A}`)} />)

    expect(await screen.findByRole('document')).toHaveTextContent('你')
  })

  it('keeps single-byte characters and following ASCII separate', async () => {
    const bytes = Uint8Array.from(String.raw`{\rtf1\ansi\ansicpg1252 Caf` + '\xe9A}', (character) =>
      character.charCodeAt(0)
    )
    render(<Preview source={source('', 'single-byte.rtf', { size: bytes.length, readRange: async () => bytes })} />)

    expect(await screen.findByRole('document')).toHaveTextContent('CaféA')
  })

  it.each([String.raw`\'a7`, String.raw`\'a7\u65?`, String.raw`\'a7\b A`, String.raw`\'a7{A}`])(
    'rejects an incomplete byte sequence instead of printing undefined: %s',
    async (encoded) => {
      render(<Preview source={source(String.raw`{\rtf1\ansi\ansicpg950 ${encoded}}`)} />)

      expect(await screen.findByRole('alert')).toHaveTextContent('Preview failed')
      expect(screen.queryByRole('document')).not.toBeInTheDocument()
    }
  )

  it('renders embedded PNG images and keeps markup-like text inert', async () => {
    const png =
      '89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082'
    render(<Preview source={source(String.raw`{\rtf1\ansi <script>alert(1)</script> {\pict\pngblip ${png}}}`)} />)

    const body = await screen.findByRole('document')
    expect(body).toHaveTextContent('<script>alert(1)</script>')
    expect(within(body).getByRole('img')).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/))
  })

  it('consumes binary image bytes without interpreting them as RTF syntax', async () => {
    // This valid PNG contains braces and a backslash in its text metadata.
    const pngHex =
      '89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001b74455874436f6d6d656e74007d5c627b2042494e415259205041594c4f41445987ba9e0000001449444154789c63f8cfc0c000c20cffffff6700001eef04fca3c8b4f70000000049454e44ae426082'
    const png = Uint8Array.from(pngHex.match(/../g)!, (byte) => Number.parseInt(byte, 16))
    const prefix = new TextEncoder().encode(String.raw`{\rtf1\ansi Before {\pict\pngblip\bin${png.length} `)
    const suffix = new TextEncoder().encode('} After}')
    const bytes = new Uint8Array([...prefix, ...png, ...suffix])
    render(<Preview source={source('', 'binary-image.rtf', { size: bytes.length, readRange: async () => bytes })} />)

    const body = await screen.findByRole('document')
    expect(body).toHaveTextContent(/^Before After$/)
    expect(within(body).getByRole('img')).toHaveAttribute(
      'src',
      `data:image/png;base64,${btoa(String.fromCharCode(...png))}`
    )
  })

  it('rejects a binary image whose declared length exceeds the available bytes', async () => {
    render(<Preview source={source(String.raw`{\rtf1\ansi {\pict\pngblip\bin100 abc}`)} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Preview failed')
    expect(screen.queryByRole('document')).not.toBeInTheDocument()
  })

  it('preserves safe links while rendering executable, local and relative links as text', async () => {
    const rtf = String.raw`{\rtf1\ansi
      {\field{\*\fldinst HYPERLINK "https://example.com/"}{\fldrslt Website}}
      {\field{\*\fldinst HYPERLINK "javascript:alert(1)"}{\fldrslt Script}}
      {\field{\*\fldinst HYPERLINK "file:///private/file"}{\fldrslt Local}}
      {\field{\*\fldinst HYPERLINK "../secret"}{\fldrslt Relative}}
    }`
    render(<Preview source={source(rtf)} />)

    const body = await screen.findByRole('document')
    const link = within(body).getByRole('link', { name: 'Website' })
    expect(link).toHaveAttribute('href', 'https://example.com/')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
    expect(within(body).getAllByRole('link')).toHaveLength(1)
    expect(body).toHaveTextContent('Script Local Relative')
  })

  it('renders a valid empty document without treating it as a failure', async () => {
    render(<Preview source={source(String.raw`{\rtf1\ansi }`)} />)

    expect(await screen.findByRole('document')).toHaveTextContent('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['not an RTF document', String.raw`{\rtf1\ansi Unclosed`])(
    'contains malformed input in the preview error state: %s',
    async (rtf) => {
      render(<Preview source={source(rtf)} />)

      expect(await screen.findByRole('alert')).toHaveTextContent('Preview failed')
      expect(screen.queryByRole('document')).not.toBeInTheDocument()
    }
  )

  it('reports read failures and releases the document', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const onError = vi.fn()
    render(
      <Preview
        source={source('', 'missing.rtf', {
          readRange: async () => {
            throw new Error('Read failed')
          },
          close
        })}
        onError={onError}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Preview failed')
    expect(close).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'load_error' }))
  })

  it('rejects oversized files before reading and opens externally only on request', async () => {
    const readRange = vi.fn()
    const onRequestOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <Preview
        source={source('', 'large.rtf', { size: 10 * 1024 * 1024 + 1, readRange })}
        onRequestOpen={onRequestOpen}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('File too large to preview')
    expect(readRange).not.toHaveBeenCalled()
    expect(onRequestOpen).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Open with default app' }))
    expect(onRequestOpen).toHaveBeenCalledWith('too_large')
  })

  it('discards a late read after switching to another document', async () => {
    const pending = Promise.withResolvers<Uint8Array>()
    const oldBytes = new TextEncoder().encode(String.raw`{\rtf1 Old document}`)
    const close = vi.fn().mockResolvedValue(undefined)
    const readRange = vi.fn(() => pending.promise)
    const view = render(<Preview source={source('', 'old.rtf', { size: oldBytes.length, readRange, close })} />)
    await waitFor(() => expect(readRange).toHaveBeenCalledOnce())

    view.rerender(<Preview source={source(String.raw`{\rtf1 New document}`, 'new.rtf')} />)
    expect(await screen.findByRole('document', { name: 'new.rtf' })).toHaveTextContent('New document')
    await act(async () => pending.resolve(oldBytes))
    expect(screen.getByRole('document')).not.toHaveTextContent('Old document')
    expect(close).toHaveBeenCalledOnce()
  })
})
