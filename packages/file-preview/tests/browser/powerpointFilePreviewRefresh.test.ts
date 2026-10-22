import { expect, test } from '@playwright/test'
import JSZip from 'jszip'

async function createDeck(height: number, count = 10) {
  const zip = new JSZip()
  const presentationNamespace = 'http://schemas.openxmlformats.org/presentationml/2006/main'
  const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="${presentationNamespace}" xmlns:r="${relationshipNamespace}"><p:sldIdLst>${Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="${height}"/></p:presentation>`
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 1}" Type="${relationshipNamespace}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`
  )
  for (let i = 1; i <= count; i++) {
    zip.file(
      `ppt/slides/slide${i}.xml`,
      `<p:sld xmlns:p="${presentationNamespace}"><p:cSld><p:spTree/></p:cSld></p:sld>`
    )
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('PPTX refresh retains the slide and its reading offset when slide geometry changes', async ({ page }) => {
  let bytes = await createDeck(4572000)
  await page.route('**/slides.pptx', (route) => route.fulfill({ body: bytes }))
  await page.goto('/tests/browser/powerpoint.html')
  const indicator = page.getByTestId('pptx-preview-page-indicator')
  const nextPage = page.getByRole('button', { name: 'Next', exact: true })
  const container = page.getByRole('region', { name: 'slides.pptx' })
  const slide = page.locator('[data-slide-index="4"]')
  const readingOffset = () =>
    slide.evaluate((node) => node.getBoundingClientRect().top - node.parentElement!.getBoundingClientRect().top)
  await expect(indicator).toHaveText('1 / 10')
  for (let number = 2; number <= 5; number++) {
    await nextPage.click()
    await expect(indicator).toHaveText(`${number} / 10`)
  }
  // The indicator updates before the native navigation scroll finishes.
  await expect(nextPage).toBeEnabled()
  await container.evaluate((node) => {
    const target = node.querySelector<HTMLElement>('[data-slide-index="4"]')!
    node.scrollTop = target.offsetTop + 80
  })
  await expect.poll(readingOffset).toBeCloseTo(-80, 0)
  const oldSlide = await slide.elementHandle()

  bytes = await createDeck(9144000)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect.poll(() => oldSlide.evaluate((node) => node.isConnected)).toBe(false)
  await expect(indicator).toHaveText('5 / 10')
  await expect(nextPage).toBeEnabled()
  await expect.poll(readingOffset).toBeCloseTo(-80, 0)
  await page.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(container).toBeHidden()
  await page.getByRole('button', { name: 'Show', exact: true }).click()
  await expect(indicator).toHaveText('5 / 10')
  await expect(nextPage).toBeEnabled()
  await expect.poll(readingOffset).toBeCloseTo(-80, 0)
})
