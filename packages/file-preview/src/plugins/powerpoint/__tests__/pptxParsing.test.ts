import { buildPresentation, buildTextIndex, parseZipLazyMedia, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function createPresentationFiles(presentation?: string) {
  const zip = new JSZip()
  zip.file(
    'ppt/presentation.xml',
    presentation ??
      '\uFEFF<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    '\uFEFF<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
  )
  zip.file(
    'ppt/slides/slide1.xml',
    '\uFEFF<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>BOM slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  )
  return parseZipLazyMedia(await zip.generateAsync({ type: 'arraybuffer' }), RECOMMENDED_ZIP_LIMITS)
}

afterEach(() => vi.restoreAllMocks())

describe('PPTX XML parsing', () => {
  it('reads BOM-prefixed XML and relationships even when the browser rejects a leading BOM', async () => {
    const parseFromString = DOMParser.prototype.parseFromString
    // Reproduce WebKit's string-parser rejection; jsdom alone accepts the BOM and would hide the regression.
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(function (this: DOMParser, input, type) {
      return parseFromString.call(this, input.startsWith('\uFEFF') ? '<invalid>' : input, type)
    })

    const presentation = buildPresentation(await createPresentationFiles(), { lazySlides: true })

    expect(presentation.slides).toHaveLength(1)
    expect(buildTextIndex(presentation).map((entry) => entry.text)).toContain('BOM slide')
  })

  it('rejects malformed presentation XML instead of returning an empty deck', async () => {
    const files = await createPresentationFiles('<presentation><unclosed>')

    expect(() => buildPresentation(files, { lazySlides: true })).toThrow('Failed to parse PPTX XML')
  })
})
