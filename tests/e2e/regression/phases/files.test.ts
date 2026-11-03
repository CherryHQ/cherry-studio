import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PDFDocument } from 'pdf-lib'

import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { InputFor, OutputFor } from '@shared/ipc/types'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from '../fixture'
import { selectSidebarApp } from '../helpers/navigation'
import { collectVirtualizedText } from '../helpers/virtualList'

test(...caseDefinition('MP-69'), async ({ app, mainWindow: page }, testInfo) => {
  const root = await mkdtemp(join(process.cwd(), 'tests/e2e/regression/mp69-assets-'))
  const prefix = `mp69-${Date.now()}`
  const fixtures = [
    { name: `${prefix}-sample.pdf`, type: 'document', label: 'Document' },
    { name: `${prefix}-sample.png`, type: 'image', label: 'Image' },
    { name: `${prefix}-sample.mp4`, type: 'video', label: 'Video' },
    { name: `${prefix}-sample.wav`, type: 'audio', label: 'Audio' },
    { name: `${prefix}-sample.bin`, type: 'other', label: 'Other' },
    { name: `${prefix}-control.pdf`, type: 'document', label: 'Document' }
  ] as const
  const ids: string[] = []
  const view = page.locator('[data-ui~="files.view"]')
  const navigation = view.locator('[data-ui~="files.navigation"]')
  const content = view.locator('[data-ui~="files.content"]')
  const fileRequest = async <
    R extends 'file.batch_create_internal_entries' | 'file.batch_trash' | 'file.batch_permanent_delete_from_trash'
  >(
    route: R,
    input: InputFor<R>
  ) => {
    const result = (await page.evaluate(({ route, input }) => window.api.ipcApi.request(route, input), {
      route,
      input
    })) as IpcResult<OutputFor<R>>
    if (!result.ok) throw new Error(`${route}: ${result.error.message}`)
    return result.data
  }
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const readFiles = async (type?: string) => {
    const response = await page.evaluate(
      (type) =>
        window.api.dataApi.request({
          id: 'mp69-read-files',
          method: 'GET',
          path: '/files/entries',
          params: { limit: 100, inTrash: false, ...(type ? { fileType: type } : {}) }
        }),
      type
    )
    expect(response.status).toBe(200)
    return response.data as {
      items: { id: string; name: string; ext: string | null }[]
      total: number
      nextCursor?: string
    }
  }

  try {
    // Real files establish the precondition; filtering and searching use the application UI.
    const pdf = await PDFDocument.create()
    pdf.addPage().drawText(`MP-69 sample ${prefix}`)
    await writeFile(join(root, fixtures[0].name), await pdf.save())
    const control = await PDFDocument.create()
    control.addPage().drawText(`MP-69 nonmatching control ${prefix}`)
    await writeFile(join(root, fixtures[5].name), await control.save())
    await writeFile(
      join(root, fixtures[1].name),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNQTX79HwAElwJzdIqk6AAAAABJRU5ErkJggg==',
        'base64'
      )
    )
    await copyFile(app.fixturesPath('media', 'sample-5s.mp4'), join(root, fixtures[2].name))
    await copyFile(app.fixturesPath('media', 'sample.wav'), join(root, fixtures[3].name))
    await writeFile(join(root, fixtures[4].name), Buffer.from(`MP-69 binary ${prefix}\0`))
    for (const fixture of fixtures) {
      const result = await fileRequest('file.batch_create_internal_entries', {
        items: [
          { source: 'path', path: AbsoluteFilePathSchema.parse(join(root, fixture.name)), cleanupPolicy: 'manual' }
        ]
      })
      ids.push(...result.succeeded.map(({ id }) => id))
      expect(result.failed).toEqual([])
      expect(result.succeeded).toHaveLength(1)
    }
    await selectSidebarApp(page, 'Files')
    await expect(view).toBeVisible()
    await screenshot('MP-69 file library with seeded files')
    const all = await readFiles()
    expect(all.nextCursor, 'All fixtures and existing files must fit in the verification page').toBeUndefined()
    const allNames = all.items.map(({ name, ext }) => (ext ? `${name}.${ext}` : name))
    // The library renders only its visible window, so it is read while scrolling.
    const scroller = content.locator('[data-scrolling]').first()
    const listedText = () => collectVirtualizedText(page, scroller)
    const expectListed = async (names: string[], message: string) => {
      const text = await listedText()
      expect(
        names.filter((name) => !text.includes(name)),
        message
      ).toEqual([])
    }
    await expectListed(allNames, 'Every stored file must be listed')
    await expect(navigation.getByRole('button', { name: /^All Files/ })).toContainText(String(all.total))

    await test.step('Each category shows only its files and the correct count', async () => {
      for (const fixture of fixtures.slice(0, 5)) {
        const expected = await readFiles(fixture.type)
        const category = navigation.getByRole('button', { name: new RegExp(`^${fixture.label}`) })
        await expect(category).toHaveText(new RegExp(`^${fixture.label}\\s*${expected.total}$`))
        await category.click()
        const listed = await listedText()
        const names = expected.items.map(({ name, ext }) => (ext ? `${name}.${ext}` : name))
        expect(
          names.filter((name) => !listed.includes(name)),
          `Every ${fixture.label} file must be listed`
        ).toEqual([])
        for (const other of fixtures.filter(({ type }) => type !== fixture.type)) {
          expect(listed, `${other.name} must not be listed under ${fixture.label}`).not.toContain(other.name)
        }
        await screenshot(`MP-69 ${fixture.label} filter and count`)
      }
    })

    await navigation.getByText('All Files', { exact: true }).click()
    await expectListed(allNames, 'Every stored file must be listed again after clearing the filter')
    await screenshot('MP-69 all files after clearing filters')
    testInfo.annotations.push({
      type: 'uncovered',
      description:
        'The file library has no filename-search control. This case verifies category filtering and counts; filename search, highlighting, and no-match states are not implemented.'
    })
  } finally {
    if (ids.length) {
      const trashed = await fileRequest('file.batch_trash', { ids })
      const deleted = await fileRequest('file.batch_permanent_delete_from_trash', { ids: trashed.succeeded })
      expect([...trashed.failed, ...deleted.failed]).toEqual([])
    }
    await rm(root, { recursive: true, force: true })
  }
})
