import JSZip from 'jszip'
import sharp from 'sharp'

export const runText = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
export const picture = (id = 'r1') => `<w:r><w:drawing><a:blip r:embed="${id}"/></w:drawing></w:r>`
export const paragraph = (body: string) => `<w:p>${body}</w:p>`
export const documentXml = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}</w:body></w:document>`
export const relationshipsXml = (
  members = '<Relationship Id="r1" Target="media/a.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>'
) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${members}</Relationships>`
export const png = (width = 128, height = 128, background = '#ff0000') =>
  sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer()
export async function docx(
  body: string,
  members: Record<string, Uint8Array> = {},
  relationships = relationshipsXml()
): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', documentXml(body))
  zip.file('word/_rels/document.xml.rels', relationships)
  for (const [name, bytes] of Object.entries(members)) zip.file(name, bytes)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
