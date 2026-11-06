import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'

import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend<{ isolatedProfile: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture arguments.
  isolatedProfile: async ({}, use, testInfo) => {
    await mkdir(testInfo.outputPath(), { recursive: true })
    const profile = await mkdtemp(testInfo.outputPath('profile-'))
    try {
      await use(profile)
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  },
  electronApp: async ({ isolatedProfile }, use) => {
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, CS_DEV_PROFILE_ROOT: isolatedProfile, NODE_ENV: 'development' },
      timeout: 60_000
    })
    try {
      await use(app)
    } finally {
      await app.close()
    }
  }
})

const zhZip = '未找到可安装的技能。技能 ZIP 压缩包必须在根目录或某个子目录里包含 SKILL.md。'
const zhDirectory = '未在所选文件夹中找到 SKILL.md。请选择直接包含 SKILL.md 的文件夹。'
const forbiddenPath =
  /skill-install|zip[-_]install[-_]|AppData[\\/]Local[\\/]Temp|[\\/]Temp[\\/]|[\\/]tmp[\\/]|[\\/]var[\\/]folders[\\/]|[A-Za-z]:[\\/]|[\\/]Users[\\/]/i

test('local skill import reports complete Chinese failures and installs valid ZIPs and folders', async ({
  electronApp,
  isolatedProfile,
  mainWindow: page
}, testInfo) => {
  test.setTimeout(240_000)
  const fixtureRoot = testInfo.outputPath('fixtures')
  await mkdir(fixtureRoot, { recursive: true })
  const unique = `skill-import-${Date.now()}`
  const names = { root: `${unique}-root`, nested: `${unique}-nested`, directory: `${unique}-directory` }
  const descriptor = (name: string) =>
    Buffer.from(`---\nname: ${name}\ndescription: Local import smoke fixture ${name}\n---\n# Skill\n`)
  const archives = [
    { name: 'no-skill.zip', entry: 'paper-pilot-main/README.md', content: Buffer.from('# No descriptor') },
    { name: 'root-skill.zip', entry: 'SKILL.md', content: descriptor(names.root) },
    { name: 'nested-skill.zip', entry: `${names.nested}/SKILL.md`, content: descriptor(names.nested) }
  ]
  for (const fixture of archives) {
    const archive = new AdmZip()
    archive.addFile(fixture.entry, fixture.content)
    archive.writeZip(path.join(fixtureRoot, fixture.name))
  }
  const directories = [
    { name: 'empty-dir', entry: null },
    { name: 'parent-only-dir', entry: `${unique}/SKILL.md` },
    { name: 'valid-dir', entry: 'SKILL.md' }
  ]
  for (const fixture of directories) {
    const folder = path.join(fixtureRoot, fixture.name)
    await mkdir(folder, { recursive: true })
    if (fixture.entry) {
      const file = path.join(folder, fixture.entry)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, descriptor(fixture.name === 'valid-dir' ? names.directory : `${unique}-parent-only`))
    }
  }
  const manifest = testInfo.outputPath('fixtures.json')
  await writeFile(
    manifest,
    JSON.stringify(
      {
        fixtureRoot,
        profile: isolatedProfile,
        isolation:
          'Unique absolute profile created before launch; CS_DEV_PROFILE_ROOT overrides the inherited profile; removed after Electron closes. Only app.language in this isolated profile is pinned to zh-CN; no model/API calls.',
        archives: archives.map(({ name, entry }) => ({ name, entry })),
        directories,
        names
      },
      null,
      2
    )
  )
  await testInfo.attach('skill-import-fixtures', { path: manifest, contentType: 'application/json' })

  const originalDialog = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '导入技能', exact: true }) })
  const results = dialog.getByTestId('skill-import-results')
  const settings = page.locator('[data-ui="settings.view"]')
  const screenshot = async (name: string) => {
    const file = testInfo.outputPath(`${name}.png`)
    await page.screenshot({ path: file, timeout: 15_000 })
    await testInfo.attach(name, { path: file, contentType: 'image/png' })
  }
  const openImport = async () => {
    await settings.getByRole('button', { name: '添加技能', exact: true }).first().click({ timeout: 15_000 })
    await page.getByRole('menuitem', { name: '本地导入', exact: true }).first().click({ timeout: 15_000 })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(results).toHaveCount(0, { timeout: 15_000 })
  }
  const pick = async (name: string, button: string) => {
    const errorRow = results.getByTitle(/^技能安装失败：/)
    const previousError = (await errorRow.count()) ? await errorRow.elementHandle({ timeout: 15_000 }) : null
    try {
      await electronApp.evaluate(
        ({ dialog }, filePath) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
        },
        path.join(fixtureRoot, name)
      )
      await dialog.getByRole('button', { name: button, exact: true }).first().click({ timeout: 15_000 })
      // A repeated selection must replace the previous result before its identical text can pass.
      await previousError?.waitForElementState('hidden', { timeout: 15_000 })
    } finally {
      await previousError?.dispose()
    }
  }
  const assertFailure = async (name: string, reason: string) => {
    const fullMessage = `技能安装失败：${name}: ${reason}`
    await expect(results).toBeVisible({ timeout: 15_000 })
    await expect(results).toContainText(fullMessage, { timeout: 15_000 })
    await expect(results.getByTitle(fullMessage, { exact: true })).toHaveAttribute('title', fullMessage, {
      timeout: 15_000
    })
    const text = await results.innerText({ timeout: 15_000 })
    const titles = await results
      .locator('[title]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title') ?? ''))
    for (const value of [text, ...titles]) {
      expect(value).not.toMatch(forbiddenPath)
      expect(value).not.toContain(fixtureRoot)
      expect(value).not.toContain(isolatedProfile)
    }
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('status').filter({ hasText: /^技能已安装：/ })).toHaveCount(0, { timeout: 15_000 })
  }
  const assertSuccess = async (name: string, evidenceName: string) => {
    const message = `技能已安装：${name}`
    const toast = page.getByRole('status').filter({ hasText: message })
    await expect(toast).toHaveText(message, { timeout: 15_000 })
    await screenshot(evidenceName)
    await expect(dialog).toBeHidden({ timeout: 15_000 })
  }

  try {
    const shell = page.locator('[data-ui~="app.shell"]').first()
    const onboarding = page.locator('[data-onboarding-language-select]')
    const skipOnboarding = page.getByRole('button', { name: '稍后设置', exact: true })
    const settingsButton = shell.getByRole('button', { name: '设置', exact: true }).filter({ visible: true }).first()

    // Host language decides the first screen (preference is null on a fresh profile), so pin it before
    // asserting any localized text: this reaches the main-process locale as well.
    await expect(shell.or(onboarding).filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 })
    await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
    expect(await page.evaluate(() => window.api.preference.get('app.language'))).toBe('zh-CN')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(shell.or(onboarding).filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 })
    expect(await page.evaluate(() => window.api.preference.get('app.language'))).toBe('zh-CN')

    await expect(skipOnboarding).toBeVisible({ timeout: 30_000 })
    await expect(skipOnboarding).toBeEnabled({ timeout: 30_000 })
    await skipOnboarding.click({ timeout: 30_000 })
    await expect(onboarding).toBeHidden({ timeout: 60_000 })
    await expect(shell).toBeVisible({ timeout: 60_000 })

    await expect(settings.or(settingsButton).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
    if (!(await settings.isVisible())) await settingsButton.click({ timeout: 30_000 })
    await expect(settings).toBeVisible({ timeout: 30_000 })
    await settings
      .locator('[data-ui="settings.navigation"] [data-slot="menu-item"]')
      .filter({ hasText: /^技能$/ })
      .first()
      .click({ timeout: 15_000 })
    await expect(settings.getByRole('button', { name: '添加技能', exact: true }).first()).toBeVisible({
      timeout: 15_000
    })

    await openImport()
    await pick('no-skill.zip', '从 ZIP 文件安装')
    await assertFailure('no-skill.zip', zhZip)
    await screenshot('skill-import-missing-zh')
    await pick('no-skill.zip', '从 ZIP 文件安装')
    await assertFailure('no-skill.zip', zhZip)
    await screenshot('skill-import-missing-repeat-zh')

    await pick('empty-dir', '从文件夹安装')
    await assertFailure('empty-dir', zhDirectory)
    await pick('parent-only-dir', '从文件夹安装')
    await assertFailure('parent-only-dir', zhDirectory)

    await pick('valid-dir', '从文件夹安装')
    await assertSuccess(names.directory, 'skill-import-success-directory-zh')
    for (const layout of ['root', 'nested'] as const) {
      await openImport()
      await pick(`${layout}-skill.zip`, '从 ZIP 文件安装')
      await assertSuccess(names[layout], `skill-import-success-${layout}-zh`)
    }
  } finally {
    try {
      await electronApp.evaluate(({ dialog }, original) => {
        dialog.showOpenDialog = original
      }, originalDialog)
    } finally {
      await originalDialog.dispose()
    }
  }
})
