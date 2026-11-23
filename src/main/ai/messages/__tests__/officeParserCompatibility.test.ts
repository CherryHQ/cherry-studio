import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'
import officeParser from 'officeparser'
import { describe, expect, it } from 'vitest'

describe('officeparser archive compatibility', () => {
  it('reads document text from paths and buffers without extracting archive entries', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-parser-'))
    const documentPath = path.join(directory, 'contract.docx')
    const zip = new JSZip()
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    )
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Archive security contract</w:t></w:r></w:p></w:body></w:document>'
    )
    zip.file('unrelated.txt', 'This entry must not be extracted to disk.')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    try {
      await fs.writeFile(documentPath, bytes)
      expect(await officeParser.parseOfficeAsync(bytes)).toContain('Archive security contract')
      expect(await officeParser.parseOfficeAsync(documentPath)).toContain('Archive security contract')
      expect(await fs.readdir(directory)).toEqual(['contract.docx'])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects malformed Office input', async () => {
    await expect(officeParser.parseOfficeAsync(Buffer.from('not an Office archive'))).rejects.toBeDefined()
  })
})
