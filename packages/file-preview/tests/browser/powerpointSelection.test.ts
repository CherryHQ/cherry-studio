import { expect, test } from '@playwright/test'
import JSZip from 'jszip'

async function createDeck() {
  const zip = new JSZip()
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main'
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst>${Array.from({ length: 5 }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: 5 }, (_, i) => `<Relationship Id="rId${i + 1}" Type="${r}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`
  )
  const shape = (id: number, x: number, text: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="shape"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x * 9525}" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
  const blocker = `<p:sp><p:nvSpPr><p:cNvPr id="9" name="blocker"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="6400800" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`
  for (let i = 1; i <= 5; i++)
    zip.file(
      `ppt/slides/slide${i}.xml`,
      `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${shape(4, 96, 'Roadmap')}${shape(7, 384, 'Goals')}${blocker}</p:spTree></p:cSld></p:sld>`
    )
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('selects PPTX shapes and clears a repeated pick', async ({ page }) => {
  await page.route('**/slides.pptx', async (route) => route.fulfill({ body: await createDeck() }))
  await page.goto('/tests/browser/powerpoint.html')
  await expect(page.getByTestId('pptx-preview-page-indicator')).toHaveText('1 / 5')
  const root = page.locator('[data-slide-index="0"] > div > div').first()
  const click = async (x: number, y: number) => {
    const rect = await root.boundingBox()
    if (!rect) throw new Error('Slide root is not mounted')
    await page.mouse.click(rect.x + (x / 960) * rect.width, rect.y + (y / 720) * rect.height)
  }
  const log = page.getByTestId('pptx-selection-log')
  await click(110, 110)
  await expect(page.locator('[data-slide-index="0"][data-pptx-picked="true"]')).toHaveCount(1)
  await expect(log).toContainText(/"nodeId":\s*"4"/)
  await expect(log).toContainText(/"excerpt":\s*"Roadmap"/)
  await click(400, 110)
  await expect(log).toContainText(/"nodeId":\s*"7"/)
  await expect(log).toContainText(/"excerpt":\s*"Goals"/)
  await click(400, 110)
  await expect.poll(async () => JSON.parse((await log.textContent()) || '[]').at(-1)).toBeNull()
  await click(700, 110)
  await expect
    .poll(async () => JSON.parse((await log.textContent()) || '[]').at(-1)?.anchor)
    .toEqual({ format: 'pptx', slide: 1 })
  await page.screenshot({
    path: '/Volumes/cherrydev/development/cherry-studio/worktrees/.tasks/issue-22028/round-1/pptx-selection.png'
  })
})
