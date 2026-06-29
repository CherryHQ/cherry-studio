import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { convertMock } = vi.hoisted(() => ({
  convertMock: vi.fn()
}))

vi.mock('officeparser', () => ({
  OfficeConverter: {
    convert: convertMock
  }
}))

import { renderOfficePreviewHtml } from '../renderOfficePreviewHtml'

describe('renderOfficePreviewHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Office files to hardened HTML', async () => {
    convertMock.mockResolvedValueOnce({
      value: '<p>Hello</p>',
      messages: [{ code: 'notice', message: 'partial support' }]
    })

    const html = await renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')

    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('<p>Hello</p>')
    expect(convertMock).toHaveBeenCalledWith('/tmp/workspace/report.docx', 'html', expect.any(Object))
  })

  it('falls back to escaped text when HTML conversion returns empty output', async () => {
    convertMock
      .mockResolvedValueOnce({ value: '  ', messages: [] })
      .mockResolvedValueOnce({ value: 'plain <text>', messages: [] })

    await expect(renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')).resolves.toContain(
      '<pre class="office-preview-text-fallback">plain &lt;text&gt;</pre>'
    )
    expect(convertMock).toHaveBeenNthCalledWith(2, '/tmp/workspace/report.docx', 'text', expect.any(Object))
  })

  it('uses the standalone HTML generator without remote chart scripts', async () => {
    convertMock.mockResolvedValueOnce({
      value: '<!DOCTYPE html><html><body><div class="spreadsheet-tabs"></div></body></html>',
      messages: []
    })

    await renderOfficePreviewHtml('/tmp/workspace/report.xlsx', 'xlsx')

    const config = convertMock.mock.calls[0][2]
    expect(config.generatorConfig).toMatchObject({
      includeFormatting: true,
      includeImages: true,
      includeCharts: false,
      htmlConfig: {
        standalone: true,
        containerWidth: '100%'
      }
    })
    // The bootstrap is no longer injected through the converter — the hardener
    // adds it (behind a nonce) after stripping document-supplied scripts.
    expect(config.generatorConfig.htmlConfig).not.toHaveProperty('injections')
    expect(config.parseConfig).not.toHaveProperty('extractAttachments', false)
    expect(config.parseConfig).not.toHaveProperty('ignoreNotes', true)
    expect(config.parseConfig).not.toHaveProperty('ignoreComments', true)
  })

  it('injects the trusted bootstrap behind a per-render CSP nonce', async () => {
    convertMock.mockResolvedValueOnce({
      value: '<!DOCTYPE html><html><body><div class="spreadsheet-tabs"></div></body></html>',
      messages: []
    })

    const html = await renderOfficePreviewHtml('/tmp/workspace/report.xlsx', 'xlsx')

    expect(html).toContain('Object.defineProperty(window')
    expect(html).toContain('a.spreadsheet-tab[href^="#sheet-"]')
    expect(html).not.toContain("script-src 'unsafe-inline'")

    const nonceMatch = html.match(/<script nonce="([^"]+)">/)
    expect(nonceMatch).not.toBeNull()
    expect(html).toContain(`script-src 'nonce-${nonceMatch?.[1]}'`)
  })

  it('keeps spreadsheet sheet tabs interactive after stripping converter scripts', async () => {
    convertMock.mockResolvedValueOnce({
      value: `<!DOCTYPE html>
<html>
<body>
  <div class="spreadsheet-container">
    <article>
      <div id="sheet-0" class="spreadsheet-sheet active"><table><tbody><tr><td>A1</td></tr></tbody></table></div>
      <div id="sheet-1" class="spreadsheet-sheet"><table><tbody><tr><td>B1</td></tr></tbody></table></div>
    </article>
    <div class="spreadsheet-tabs">
      <a href="#sheet-0" class="spreadsheet-tab active">Sheet1</a>
      <a href="#sheet-1" class="spreadsheet-tab">Sheet2</a>
    </div>
  </div>
  <script>window.__converterSheetSwitch = true</script>
</body>
</html>`,
      messages: []
    })

    const html = await renderOfficePreviewHtml('/tmp/workspace/report.xlsx', 'xlsx')
    expect(html).not.toContain('__converterSheetSwitch')

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'https://office-preview.local/report.xlsx'
    })
    const { document, MouseEvent } = dom.window
    const sheet0 = document.getElementById('sheet-0')
    const sheet1 = document.getElementById('sheet-1')
    const tab0 = document.querySelector<HTMLAnchorElement>('a[href="#sheet-0"]')
    const tab1 = document.querySelector<HTMLAnchorElement>('a[href="#sheet-1"]')

    tab1?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(sheet0?.classList.contains('active')).toBe(false)
    expect(sheet1?.classList.contains('active')).toBe(true)
    expect(tab0?.classList.contains('active')).toBe(false)
    expect(tab1?.classList.contains('active')).toBe(true)
  })

  it('strips inline scripts the document carried', async () => {
    convertMock.mockResolvedValueOnce({
      value:
        '<!DOCTYPE html><html><head><script>fetch("https://evil.example")</script></head><body><script nonce="attacker">alert(1)</script>hi</body></html>',
      messages: []
    })

    const html = await renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')

    expect(html).not.toContain('fetch("https://evil.example")')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('nonce="attacker"')
  })

  it('hardens generated HTML before returning it to the renderer', async () => {
    convertMock.mockResolvedValueOnce({
      value:
        '<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body><a href="javascript:alert(1)" onclick="alert(2)">link</a></body></html>',
      messages: []
    })

    const html = await renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')

    expect(html).toContain('Content-Security-Policy')
    expect(html).not.toContain('cdn.jsdelivr.net')
    expect(html).not.toContain('javascript:alert')
    expect(html).not.toContain('onclick=')
  })

  it('returns file_too_large when generated HTML is too large for IPC preview', async () => {
    convertMock.mockResolvedValueOnce({
      value: 'x'.repeat(6 * 1024 * 1024),
      messages: []
    })

    await expect(renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_FILE_TOO_LARGE'
    })
  })

  it('maps conversion failures to parse_failed and preserves the reason', async () => {
    convertMock.mockRejectedValueOnce(new Error('bad zip'))

    await expect(renderOfficePreviewHtml('/tmp/workspace/report.docx', 'docx')).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_PARSE_FAILED',
      message: 'bad zip'
    })
  })
})
