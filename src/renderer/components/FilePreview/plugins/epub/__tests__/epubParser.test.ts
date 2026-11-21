import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { EPUB_ENTRY_MAX_COUNT, EPUB_MEMBER_READ_MAX_BYTES, EPUB_SOURCE_MAX_BYTES, openEpub } from '../epubParser'

async function fixture(extra: Record<string, string | Uint8Array> = {}, opf?: string) {
  const zip = new JSZip()
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>'
  )
  zip.file(
    'OEBPS/book.opf',
    opf ??
      '<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>'
  )
  zip.file('OEBPS/a.xhtml', '<html><head><title>Same</title></head><body><p>First</p></body></html>')
  zip.file(
    'OEBPS/b.xhtml',
    '<html><head><title>Same</title><style>hidden</style></head><body><p>Second &lt;div&gt;</p><script>hidden</script><p>Next</p><pre>one\ntwo</pre></body></html>'
  )
  for (const [path, content] of Object.entries(extra)) zip.file(path, content)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('EPUB parser', () => {
  it('follows spine order and keeps duplicate titles and text boundaries', async () => {
    const book = await openEpub(await fixture())
    expect(book.chapters.map((c) => c.path)).toEqual(['OEBPS/b.xhtml', 'OEBPS/a.xhtml'])
    const first = await book.readChapter(book.chapters[0].id)
    const second = await book.readChapter(book.chapters[1].id)
    expect(first.title).toBe('Same')
    expect(second.title).toBe('Same')
    expect(first.paragraphs.join('\n')).toContain('Second <div>')
    expect(first.paragraphs.join('\n')).toContain('one\ntwo')
    expect(first.paragraphs.join('\n')).not.toContain('hidden')
    expect(first.paragraphs.join('\n')).toContain('Next')
    book.close()
    await expect(book.readChapter('0')).rejects.toThrow()
  })
  it('keeps table cells and definition list items separated', async () => {
    const book = await openEpub(
      await fixture({
        'OEBPS/a.xhtml':
          '<html><body><table><tr><td>10</td><td>20</td></tr></table><dl><dt>Term</dt><dd>Definition</dd></dl><p>wo<em>rd</em></p></body></html>'
      })
    )
    const id = book.chapters.find((c) => c.path.endsWith('a.xhtml'))!.id
    const text = (await book.readChapter(id)).paragraphs.join('\n')
    expect(text).toContain('10 20')
    expect(text).not.toContain('1020')
    expect(text).toContain('Term Definition')
    expect(text).not.toContain('TermDefinition')
    expect(text).toContain('word')
    book.close()
  })
  it('reads XHTML named entities once and recovers malformed chapters', async () => {
    const book = await openEpub(
      await fixture({
        'OEBPS/b.xhtml':
          '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html><head><title>Entities</title></head><body><p>A&nbsp;B &amp;nbsp; C</p></body></html>',
        'OEBPS/a.xhtml': '<html><body><p>Recovered text</body></html>'
      })
    )
    expect(await book.readChapter('0')).toMatchObject({ title: 'Entities', paragraphs: ['A\u00a0B &nbsp; C'] })
    expect((await book.readChapter('1')).paragraphs).toContain('Recovered text')
  })
  it('limits actual decompressed bytes even when the declared size is small', async () => {
    const bytes = await fixture({ 'OEBPS/b.xhtml': 'a'.repeat(EPUB_MEMBER_READ_MAX_BYTES + 1024) })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const name = new TextEncoder().encode('OEBPS/b.xhtml')
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue
      const nameLength = view.getUint16(i + 28, true)
      if (nameLength === name.length && name.every((byte, index) => bytes[i + 46 + index] === byte)) {
        view.setUint32(i + 24, 1, true)
        break
      }
    }
    const book = await openEpub(bytes)
    await expect(book.readChapter('0')).rejects.toMatchObject({ reason: 'too_large' })
    expect((await book.readChapter('1')).paragraphs).toContain('First')
  })
  it('retains missing chapters without blocking other chapters', async () => {
    const opf =
      '<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="missing.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>'
    const book = await openEpub(await fixture({}, opf))
    await expect(book.readChapter('0')).rejects.toMatchObject({ reason: 'unsupported_structure' })
    expect((await book.readChapter('1')).paragraphs.join()).toContain('First')
  })
  it('only blocks encrypted chapters', async () => {
    const encryption = (uri: string) =>
      `<encryption><EncryptedData><CipherReference URI="${uri}"/></EncryptedData></encryption>`
    const book = await openEpub(await fixture({ 'META-INF/encryption.xml': encryption('fonts/a.otf') }))
    expect((await book.readChapter('0')).paragraphs.join()).toContain('Second')
    const encrypted = await openEpub(await fixture({ 'META-INF/encryption.xml': encryption('OEBPS/b.xhtml') }))
    await expect(encrypted.readChapter('0')).rejects.toMatchObject({ reason: 'encrypted' })
  })
  it('rejects invalid archives and package structure', async () => {
    await expect(openEpub(new Uint8Array([1, 2]))).rejects.toMatchObject({ reason: 'damaged' })
    await expect(openEpub(await fixture({ 'META-INF/container.xml': '<broken' }))).rejects.toMatchObject({
      reason: 'unsupported_structure'
    })
    await expect(openEpub(await fixture({ 'OEBPS/book.opf': '<broken' }))).rejects.toMatchObject({
      reason: 'unsupported_structure'
    })
    await expect(openEpub(await fixture({}, '<package/>'))).rejects.toMatchObject({ reason: 'unsupported_structure' })
  })
  it.each(['../../outside', 'http://example.com/a', 'file:/a', 'data:text/plain,a'])(
    'rejects unsafe chapter path %s',
    async (href) => {
      const opf = `<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="${href}"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>`
      const book = await openEpub(await fixture({}, opf))
      await expect(book.readChapter('0')).rejects.toMatchObject({ reason: 'unsupported_structure' })
    }
  )
  it('resolves encoded spaces and hashes and decodes UTF-16LE', async () => {
    const opf =
      '<package><manifest><item id="a" href="a%20b.xhtml"/><item id="b" href="a%23b.xhtml#part"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'
    const utf16 = new Uint8Array(
      Buffer.concat([Buffer.from([255, 254]), Buffer.from('<html><body>UTF16</body></html>', 'utf16le')])
    )
    const book = await openEpub(
      await fixture({ 'OEBPS/a b.xhtml': utf16, 'OEBPS/a#b.xhtml': '<html><body>Hash</body></html>' }, opf)
    )
    expect((await book.readChapter('0')).paragraphs).toContain('UTF16')
    expect((await book.readChapter('1')).paragraphs).toContain('Hash')
  })
  it('enforces source, member and entry limits', async () => {
    await expect(openEpub(new Uint8Array(EPUB_SOURCE_MAX_BYTES + 1))).rejects.toMatchObject({ reason: 'too_large' })
    const book = await openEpub(await fixture({ 'OEBPS/b.xhtml': 'x'.repeat(EPUB_MEMBER_READ_MAX_BYTES + 1) }))
    await expect(book.readChapter('0')).rejects.toMatchObject({ reason: 'too_large' })
    const zip = new JSZip()
    for (let i = 0; i <= EPUB_ENTRY_MAX_COUNT; i++) zip.file(`${i}`, '')
    await expect(
      openEpub(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
    ).rejects.toMatchObject({ reason: 'too_large' })
  })
})
