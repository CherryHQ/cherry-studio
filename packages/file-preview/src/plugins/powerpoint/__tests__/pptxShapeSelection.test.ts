// @vitest-environment jsdom
import {
  buildPresentation,
  materializeSlideNodes,
  parseZipLazyMedia,
  RECOMMENDED_ZIP_LIMITS
} from '@aiden0z/pptx-renderer'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'

import { pickPptxSelection } from '../pptxSelectionAnchor'

const emu = (n: number) => n * 9525
const frame = (x: number, y: number, w: number, h: number, rotation = 0) =>
  `<a:xfrm rot="${rotation * 60000}"><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`
const shape = (id: string, paragraphs: string[], x: number, y = 96, rotation = 0) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="shape"/></p:nvSpPr><p:spPr>${frame(x, y, 192, 96, rotation)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.map((p) => (p ? `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>` : '<a:p/>')).join('')}</p:txBody></p:sp>`
const picture = `<p:pic><p:nvPicPr><p:cNvPr id="9" name="picture"/></p:nvPicPr><p:spPr>${frame(96, 96, 192, 96)}</p:spPr></p:pic>`
const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="table"/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(96)}" y="${emu(96)}"/><a:ext cx="${emu(192)}" cy="${emu(96)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="${emu(192)}"/></a:tblGrid><a:tr h="${emu(96)}"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
const chart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="chart"/></p:nvGraphicFramePr><p:xfrm rot="5400000"><a:off x="${emu(96)}" y="${emu(96)}"/><a:ext cx="${emu(192)}" cy="${emu(96)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>`
async function deck(nodes: string) {
  const zip = new JSZip()
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main'
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${r}/slide" Target="slides/slide2.xml"/></Relationships>`
  )
  for (let i = 1; i <= 2; i++)
    zip.file(
      `ppt/slides/slide${i}.xml`,
      `<p:sld xmlns:p="${p}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${r}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><p:cSld><p:spTree>${nodes}</p:spTree></p:cSld></p:sld>`
    )
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdChart" Type="${r}/chart" Target="../charts/chart1.xml"/></Relationships>`
  )
  return buildPresentation(
    await parseZipLazyMedia(await zip.generateAsync({ type: 'arraybuffer' }), RECOMMENDED_ZIP_LIMITS),
    { lazySlides: true }
  )
}
function dom(index = '0') {
  const item = document.createElement('div')
  item.dataset.slideIndex = index
  const wrapper = item.appendChild(document.createElement('div'))
  const root = wrapper.appendChild(document.createElement('div'))
  const rect = { left: 100, top: 50, width: 480, height: 360 } as DOMRect
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(rect)
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect)
  return { item, wrapper, root }
}
const a = shape('4', ['Roadmap', '', 'Q3 goals'], 96)
const b = shape('7', ['Second'], 384)
const point = (x: number, y: number) => ({ clientX: 100 + x / 2, clientY: 50 + y / 2 })

describe('PPTX shape selection', () => {
  it('selects native IDs and preserves empty paragraphs on each slide', async () => {
    const presentation = await deck(a + b)
    expect(pickPptxSelection(dom().root, presentation, { clientX: 155, clientY: 105 })).toEqual({
      anchor: { format: 'pptx', slide: 1, nodeId: '4' },
      excerpt: 'Roadmap\n\nQ3 goals'
    })
    expect(pickPptxSelection(dom().root, presentation, { clientX: 300, clientY: 105 })).toEqual({
      anchor: { format: 'pptx', slide: 1, nodeId: '7' },
      excerpt: 'Second'
    })
    expect(pickPptxSelection(dom('1').root, presentation, point(110, 110))?.anchor).toEqual({
      format: 'pptx',
      slide: 2,
      nodeId: '4'
    })
  })
  it.each([picture, table])('uses the slide when an unsupported frame covers text', async (blocker) => {
    const presentation = await deck(a + blocker)
    const result = pickPptxSelection(dom().root, presentation, point(110, 110))
    expect(result?.anchor).toEqual({ format: 'pptx', slide: 1 })
    expect(result?.excerpt).toContain('Roadmap\n\nQ3 goals')
  })
  it('returns raw empty text for a blank foreground shape', async () => {
    const presentation = await deck(a + shape('8', [''], 96))
    expect(pickPptxSelection(dom().root, presentation, point(110, 110))).toEqual({
      anchor: { format: 'pptx', slide: 1, nodeId: '8' },
      excerpt: ''
    })
  })
  it.each(['chart', 'unknown'])('blocks text beneath an axis-aligned rotated %s frame', async (kind) => {
    const presentation = await deck(a + chart)
    const slide = presentation.slides[0]
    materializeSlideNodes(presentation, slide)
    expect(slide.nodes[1]).toMatchObject({ nodeType: 'chart', rotation: 90 })
    if (kind === 'unknown') {
      // Model-level case: the parser's node union does not expose unknown nodes.
      slide.nodes[1] = { ...slide.nodes[1], nodeType: 'unknown' } as unknown as (typeof slide.nodes)[number]
    }
    expect(pickPptxSelection(dom().root, presentation, point(110, 110))).toEqual({
      anchor: { format: 'pptx', slide: 1 },
      excerpt: 'Roadmap\n\nQ3 goals'
    })
  })
  it('inverse rotates shape frames', async () => {
    const presentation = await deck(shape('4', ['Rotated'], 384, 288, 90))
    expect(pickPptxSelection(dom().root, presentation, point(480, 260))?.anchor).toEqual({
      format: 'pptx',
      slide: 1,
      nodeId: '4'
    })
    expect(pickPptxSelection(dom().root, presentation, point(400, 336))?.anchor).toEqual({ format: 'pptx', slide: 1 })
  })
  it('falls back for unmeasurable or clipped content and rejects invalid indices', async () => {
    const presentation = await deck(a)
    const { item, wrapper, root } = dom()
    expect(pickPptxSelection(root, presentation, point(0, 0))?.anchor).toEqual({ format: 'pptx', slide: 1 })
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 0, height: 0 } as DOMRect)
    expect(pickPptxSelection(root, presentation, point(110, 110))?.anchor).toEqual({ format: 'pptx', slide: 1 })
    wrapper.replaceChildren()
    expect(pickPptxSelection(wrapper, presentation, point(110, 110))?.anchor).toEqual({ format: 'pptx', slide: 1 })
    for (const index of ['', '-1', '1.5', 'no', '2']) {
      item.dataset.slideIndex = index
      expect(pickPptxSelection(wrapper, presentation, point(110, 110))).toBeNull()
    }
    expect(pickPptxSelection(document.createElement('div'), presentation, point(110, 110))).toBeNull()
  })
})
