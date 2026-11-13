import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import {
  closeExternalText,
  openExternalText,
  sendSystemHotkey
} from '../../../../scripts/e2e/regression/systemAutomation'
import { createAgent, openAgentPane, selectAgentWorkspace, startNewAgentTask } from '../helpers/agents'
import { ensureCustomChatProvider } from '../helpers/models'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function agentFilePreview(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const original = 'def add(a, b):\n    return a + b\n'
  const expected = '# Add two numbers.\ndef add_numbers(a, b):\n    return a + b\n'
  const target = join(app.paths.workspace, 'code', 'sample.py')
  const git = (...args: string[]) => execFileSync('git', ['-C', app.paths.workspace, ...args], { encoding: 'utf8' })
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await mkdir(join(app.paths.workspace, 'code'), { recursive: true })
  await writeFile(target, original)
  await writeFile(join(app.paths.workspace, 'code', 'untouched.py'), 'UNCHANGED = True\n')
  git('init')
  git('add', '.')
  const initialStatus = git('status', '--porcelain')
  expect(git('diff')).toBe('')
  const baseline = new Map<string, string>()
  for (const entry of await readdir(app.paths.workspace, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && !entry.parentPath.includes(`${join(app.paths.workspace, '.git')}`)) {
      const path = join(entry.parentPath, entry.name)
      baseline.set(path, await readFile(path, 'utf8'))
    }
  }

  // Real provider and runtime: neither tool output nor file contents are injected after the prompt.
  const providerId = await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const agentName = app.resourceName(`File preview ${Date.now()}`)
  await createAgent(page, {
    name: agentName,
    runtime: 'Pi',
    permission: 'Full Access',
    providerId,
    model: app.config.customProvider.chatModel
  })
  const registered = await page.evaluate(
    (path) => window.api.ipcApi.request('ai.agent.workspace.register', { path }),
    app.paths.workspace
  )
  expect(registered).toMatchObject({ ok: true })
  await startNewAgentTask(page, agentName)
  await selectAgentWorkspace(app, page)
  const view = page.locator('[data-ui~="agent.view"]:visible').first()
  const messages = view.locator('[data-ui~="chat.message"]:visible')
  const composer = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  const send = async (prompt: string) => {
    const count = await messages.count()
    await composer.fill(prompt)
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => messages.count(), { timeout: 90_000 }).toBeGreaterThan(count)
    await expect(messages.last().getByTestId('completed-process-trigger')).toBeVisible({ timeout: 90_000 })
    return messages.last()
  }
  const preview = page.getByTestId('artifact-file-preview-overlay')
  await openAgentPane(page, 'Files')
  await expect(page.getByTestId('artifact-pane-header')).toBeVisible()
  await expect(
    page.getByText("Couldn't load workspace files", { exact: true }).or(page.getByRole('treeitem').first())
  ).toBeVisible()
  await screenshot('MP-52 workspace file panel')
  await expect(
    page.getByText("Couldn't load workspace files", { exact: true }),
    'Workspace files must load before testing preview cache invalidation'
  ).toHaveCount(0)
  const code = page.getByRole('treeitem', { name: 'code', exact: true })
  await expect(code).toBeVisible()
  if ((await code.getAttribute('aria-expanded')) !== 'true') await code.click()
  await page.getByRole('treeitem', { name: 'sample.py', exact: true }).click()
  await expect(preview).toBeVisible()
  const expectPreview = async (text: string) => {
    for (const line of text.trimEnd().split('\n')) {
      await expect(preview.getByText(line.trim(), { exact: true })).toBeVisible()
    }
  }
  await expectPreview(original)
  await screenshot('MP-52 original file preview')
  await page
    .getByTestId('artifact-pane-header')
    .getByRole('button', { name: 'Close preview sample.py', exact: true })
    .click()

  const edited = await send(
    'Edit only code/sample.py using exactly one Edit tool call covering the whole file: rename add to add_numbers and add exactly one comment line "# Add two numbers." before the function. Preserve all other bytes, including the final newline. Do not create or modify any other files. Reply MP52_EDIT_DONE.'
  )
  await expect.poll(() => readFile(target, 'utf8'), { timeout: 30_000 }).toBe(expected)
  await edited.getByTestId('completed-process-trigger').click()
  for (const group of await edited.getByTestId('child-tool-group').all()) {
    const trigger = group.getByRole('button', { expanded: false }).first()
    if (await trigger.isVisible()) await trigger.click()
  }
  const diff = edited.getByTestId('collapse-content-MultiEdit').or(edited.getByTestId('collapse-content-Edit'))
  await expect(diff).toHaveCount(1)
  const editToggle = edited.locator(`[aria-controls="${await diff.getAttribute('id')}"]`)
  await expect(editToggle).toBeVisible()
  if ((await editToggle.getAttribute('aria-expanded')) !== 'true') {
    await editToggle.focus()
    await editToggle.press('Enter')
  }
  await expect(diff).toBeVisible()
  await expect(diff.getByText('def add(a, b):', { exact: true })).toBeVisible()
  await expect(diff.getByText('# Add two numbers.', { exact: true })).toBeVisible()
  await expect(diff.getByText('def add_numbers(a, b):', { exact: true })).toBeVisible()
  await screenshot('MP-52 tool diff matches disk')
  await page.getByRole('treeitem', { name: 'sample.py', exact: true }).click()
  await expect(preview).toBeVisible()
  await expectPreview(expected)
  await expect(preview.getByText('def add(a, b):', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Unsaved', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: /File changed on disk|Discard unsaved changes/ })).toHaveCount(0)
  await screenshot('MP-52 latest file preview')

  expect(git('diff', '--name-only')).toBe('code/sample.py\n')
  expect(git('status', '--porcelain')).toBe(initialStatus.replace('A  code/sample.py\n', 'AM code/sample.py\n'))
  for (const [path, contents] of baseline) {
    expect(await readFile(path, 'utf8'), path).toBe(path === target ? expected : contents)
  }
  const mac = app.record.platform === 'macos'
  await page.evaluate(() => navigator.clipboard.writeText('MP52_COPY_PENDING'))
  try {
    openExternalText(app.record.platform, { ...app.paths, fixtures: app.paths.workspace }, target)
    sendSystemHotkey(app.record.platform, [mac ? 'Meta' : 'Control', 'c'])
    await expect
      .poll(() => {
        const text = mac
          ? execFileSync('pbpaste', { encoding: 'utf8', timeout: 10_000 })
          : execFileSync(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-Command', '[Console]::Write((Get-Clipboard -Raw))'],
              { encoding: 'utf8', timeout: 10_000 }
            )
        return text.replace(/\r\n/g, '\n')
      })
      .toBe(expected)
    await testInfo.attach(`MP-52 external ${mac ? 'TextEdit' : 'Notepad'} contents`, {
      body: expected,
      contentType: 'text/plain'
    })
  } finally {
    closeExternalText(app.record.platform)
  }
}
