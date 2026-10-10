import AdmZip from 'adm-zip'
import { expect, it } from 'vitest'

const hasNativeBinding =
  ((process.platform === 'darwin' || process.platform === 'linux') &&
    (process.arch === 'arm64' || process.arch === 'x64')) ||
  (process.platform === 'win32' && process.arch === 'x64')

function createMinimalDocx(): Buffer {
  const zip = new AdmZip()
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    )
  )
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      '<?xml version="1.0"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" ' +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
        'Target="word/document.xml"/>' +
        '</Relationships>'
    )
  )
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      '<?xml version="1.0"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:p><w:r><w:t>Smoke title</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Smoke body</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    )
  )
  return zip.toBuffer()
}

it.skipIf(!hasNativeBinding)('loads the real anydoc binding and converts a docx container', async () => {
  const { toMarkdownBytes } = await import('@firecrawl/anydoc')

  const markdown = await toMarkdownBytes(createMinimalDocx())

  expect(markdown).toContain('Smoke title')
  expect(markdown).toContain('Smoke body')
})
