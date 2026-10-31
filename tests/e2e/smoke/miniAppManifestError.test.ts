import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'

import type { ElectronFixtures } from './fixtures/electron.fixture'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend<ElectronFixtures & { profileRoot: string }>({
  profileRoot: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-21756-profile-'))
    const previous = process.env.CS_DEV_PROFILE_ROOT
    process.env.CS_DEV_PROFILE_ROOT = dir
    try {
      await use(dir)
    } finally {
      if (previous === undefined) {
        delete process.env.CS_DEV_PROFILE_ROOT
      } else {
        process.env.CS_DEV_PROFILE_ROOT = previous
      }
      fs.rmSync(dir, { recursive: true, force: true })
    }
  },
  electronApp: async ({ profileRoot, electronApp }, use) => {
    void profileRoot
    await use(electronApp)
  }
})

const invalidCases = [
  {
    name: 'bad-description',
    mutation: { description: 'x'.repeat(201) },
    message: 'Could not read the package: manifest.json: `description` must be at most 200 characters.'
  },
  {
    name: 'bad-name',
    mutation: { name: 'x'.repeat(65) },
    message: 'Could not read the package: manifest.json: `name` must be at most 64 characters.'
  },
  {
    name: 'bad-empty-description',
    mutation: { description: '' },
    message: 'Could not read the package: manifest.json: `description` must not be empty.'
  },
  {
    name: 'no-root-manifest',
    mutation: {},
    message: 'Could not read the package: Package is missing manifest.json at its root'
  }
]

const boundaryName = 'x'.repeat(64)
const fixturePaths: Record<string, string> = {}
let tempDir: string

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-21756-'))
  const exampleDir = path.resolve(__dirname, '../../../docs/references/mini-app/examples/capability-tests')
  const manifestSource = fs.readFileSync(path.join(exampleDir, 'manifest.json'), 'utf8')

  for (const fixture of [
    ...invalidCases,
    { name: 'valid-boundary', mutation: { name: boundaryName, description: 'x'.repeat(200) } }
  ]) {
    const manifest = { ...JSON.parse(manifestSource), ...fixture.mutation }
    const zip = new JSZip()
    zip.file(fixture.name === 'no-root-manifest' ? 'meta.json' : 'manifest.json', JSON.stringify(manifest))
    for (const filename of ['index.html', 'app.js', 'style.css', 'icon.png']) {
      zip.file(filename, fs.readFileSync(path.join(exampleDir, filename)))
    }
    const fixturePath = path.join(tempDir, `${fixture.name}.miniapp`)
    fs.writeFileSync(fixturePath, await zip.generateAsync({ type: 'nodebuffer' }))
    fixturePaths[fixture.name] = fixturePath
  }
})

test.afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
})

test('mini app package errors are readable and valid boundary manifests install', async ({
  electronApp,
  mainWindow
}, testInfo) => {
  const languageSelect = mainWindow.locator('[data-onboarding-language-select]')
  await expect(
    mainWindow
      .locator('[data-ui~="part:composer-input"], [data-onboarding-language-select], [data-launchpad-button]')
      .filter({ visible: true })
      .first()
  ).toBeVisible()
  if (await languageSelect.isVisible()) {
    await languageSelect.getByRole('combobox').click()
    await mainWindow.getByRole('option', { name: 'English', exact: false }).click()
    await mainWindow.getByRole('button', { name: 'Set up later', exact: true }).click()
  }

  await mainWindow.getByRole('button', { name: 'Launchpad', exact: true }).last().click()
  await expect(mainWindow.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()
  await mainWindow.getByRole('button', { name: 'MiniApp', exact: true }).last().click()
  const miniApps = mainWindow.locator('[data-ui~="mini-apps.view"]')
  await expect(miniApps).toBeVisible()
  await miniApps.getByRole('button', { name: 'Add mini app', exact: true }).first().click()
  await mainWindow.getByRole('tab', { name: 'Local mini app', exact: true }).click()
  const dropzone = mainWindow.locator('[data-ui~="mini-apps.install-dropzone"]').first()
  await expect(dropzone).toBeVisible()
  const picker = mainWindow.getByRole('dialog').filter({ has: dropzone })
  const alert = picker.locator('[data-slot="alert-message"]')
  const consent = mainWindow.getByRole('dialog', { name: 'Install mini app', exact: true })
  const chooseFile = picker.getByRole('button', { name: 'Choose file…', exact: true })

  const screenshot = async (name: string) => {
    const screenshotPath = testInfo.outputPath(`${name}.png`)
    await mainWindow.screenshot({ path: screenshotPath })
    await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
  }

  const assertError = async (message: string) => {
    await expect(alert).toBeVisible()
    await expect(alert).toHaveText(message)
    for (const rawIssue of ['"origin"', '"code"', 'too_big', 'too_small', '"path"']) {
      await expect(alert).not.toContainText(rawIssue)
    }
    await expect(consent).toHaveCount(0)
  }

  const drop = async (fixturePath: string) => {
    await expect(chooseFile).toBeEnabled()
    const box = await dropzone.boundingBox()
    if (!box) throw new Error('Mini app install dropzone has no bounding box')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const cdp = await mainWindow.context().newCDPSession(mainWindow)
    const data = {
      items: [{ mimeType: 'application/x-miniapp', data: '' }],
      files: [fixturePath],
      dragOperationsMask: 1
    }
    try {
      await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data })
      await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data })
      await cdp.send('Input.dispatchDragEvent', { type: 'drop', x, y, data })
    } finally {
      await cdp.detach()
    }
  }

  for (const fixture of invalidCases) {
    await drop(fixturePaths[fixture.name])
    await assertError(fixture.message)
    await screenshot(fixture.name)
  }

  const originalShowOpenDialog = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
  try {
    // Only the OS dialog is substituted; renderer, preload, IPC, install flow, archive reader and schema are real.
    await electronApp.evaluate(({ dialog }, fixturePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixturePath] })
    }, fixturePaths['bad-description'])
    await chooseFile.click()
    await assertError(invalidCases[0].message)
    await screenshot('bad-description-picker')
  } finally {
    await electronApp.evaluate(({ dialog }, original) => {
      dialog.showOpenDialog = original
    }, originalShowOpenDialog)
    await originalShowOpenDialog.dispose()
  }

  await drop(fixturePaths['valid-boundary'])
  await expect(consent.getByRole('heading', { name: 'Install mini app', exact: true })).toBeVisible()
  await expect(mainWindow.locator('[data-slot="alert-message"]')).toHaveCount(0)
  await screenshot('valid-boundary-consent')
  await consent.getByRole('button', { name: 'Install', exact: true }).click()
  await expect(
    mainWindow.getByRole('region', { name: 'notifications' }).getByText(`Installed ${boundaryName}`, { exact: true })
  ).toBeVisible()
  await expect(dropzone).toHaveCount(0)
  await screenshot('valid-boundary')
})
