import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import type { AgentEntity } from '../../../../src/shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '../../../../src/shared/data/api/schemas/agentSessions'
import type { OffsetPaginationResponse } from '../../../../src/shared/data/api/types'
import type { IpcResult } from '../../../../src/shared/ipc/errors/IpcError'

export default async function fileComments(context: ScenarioContext): Promise<void> {
  const { page } = context
  await context.ensureChinese()
  const original = 'const original = 1;\nconst second = 2;\n'
  const readOnlySource = 'const readonly = "中文 🥟";\n'
  const name = `file-comments-${Date.now()}`
  const editableName = `${name}-edit.ts`
  const readOnlyName = `${name}-readonly.ts`
  const preferences = await page.evaluate(async () => ({
    lineNumbers: await window.api.preference.get('chat.code.show_line_numbers'),
    autoSave: await window.api.preference.get('feature.agent.file_pane.auto_save')
  }))
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  let session: AgentSessionEntity | undefined

  try {
    const agents = await page.evaluate(() =>
      window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: '/agents', params: { limit: 200 } })
    )
    expect(agents.status).toBe(200)
    const agent = (agents.data as OffsetPaginationResponse<AgentEntity>).items.find(
      (candidate) => candidate.configuration?.builtin_role === 'assistant'
    )
    if (!agent) throw new Error('Built-in assistant is missing')
    const created = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId: agent.id, name }
    )
    expect(created.status).toBe(201)
    session = created.data as AgentSessionEntity
    const editablePath = join(session.workspace.path, editableName)
    const readOnlyPath = join(session.workspace.path, readOnlyName)
    await mkdir(session.workspace.path, { recursive: true })
    await writeFile(editablePath, original)
    await writeFile(readOnlyPath, readOnlySource)
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'chat.code.show_line_numbers': true,
        'feature.agent.file_pane.auto_save': true
      })
    )

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('button[aria-label="工作"]:not([data-tab-id])').click()
    const sessionRow = page.getByText(name, { exact: true })
    if (!(await sessionRow.isVisible()))
      await page
        .getByRole('button', { name: new RegExp(agent.name) })
        .first()
        .click()
    await sessionRow.click()
    await expect(page.getByRole('option', { name: new RegExp(name) })).toHaveAttribute('aria-selected', 'true')
    const fileRow = page.getByRole('treeitem', { name: editableName, exact: true })
    if (!(await page.getByTestId('artifact-pane-header').isVisible())) {
      await page.getByRole('button', { name: '文件', exact: true }).click()
    }
    await fileRow.click()
    const editor = page.getByRole('textbox', { name: editableName, exact: true })
    await expect(editor).toBeVisible()
    await context.runSteps([{ verb: 'expectVisible', selector: 'diffs-container' }])
    const composer = page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()
    const comment = page.getByRole('textbox', { name: /给智能体的评论/ })
    const openComment = async () => {
      // Pierre's gutter button has no accessible name; its maintained data attribute identifies it.
      await page.locator('diffs-container [data-content] [data-line="1"]').hover()
      const button = page.locator('diffs-container [data-utility-button]')
      await expect(button).toBeVisible()
      await button.click()
      await expect(comment).toBeFocused()
    }

    await openComment()
    await comment.fill('Discard this draft')
    await composer.click()
    // A queued editor refocus used to run after the click and redirect message typing into the file.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    )
    await expect(comment).toHaveCount(0)
    await expect(composer).toBeFocused()
    await page.keyboard.insertText('Message only')
    await expect(composer).toHaveText('Message only')
    expect(await readFile(editablePath, 'utf8')).toBe(original)
    await composer.press('ControlOrMeta+a')
    await composer.press('Backspace')

    await openComment()
    await comment.press('Escape')
    await expect(comment).toHaveCount(0)
    await expect(editor).toBeFocused()

    await openComment()
    await comment.fill('Cancel from the button')
    await comment.press('Tab')
    const submitButton = page.getByRole('button', { name: '评论', exact: true })
    await expect(submitButton).toBeFocused()
    await submitButton.press('Escape')
    await expect(comment).toHaveCount(0)
    await expect(editor).toBeVisible()
    await expect(editor).toBeFocused()
    await expect(composer).toBeEmpty()

    await editor.press('ControlOrMeta+Home')
    await page.keyboard.insertText('EDITED ')
    await expect.poll(() => readFile(editablePath, 'utf8')).toBe(`EDITED ${original}`)
    await openComment()
    await comment.fill('Inspect latest source')
    await page.getByRole('button', { name: '评论', exact: true }).click()
    await expect(composer.getByText(`${editableName} · L1`, { exact: true })).toBeVisible()
    await expect(composer).toBeFocused()
    await composer.press('ControlOrMeta+a')
    await composer.press('ControlOrMeta+c')
    expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(
      `\`${editablePath}:1\`\n\`\`\`\nEDITED const original = 1;\n\`\`\`\nInspect latest source`
    )
    await composer.press('Backspace')

    await page.getByRole('treeitem', { name: readOnlyName, exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '作为上下文附加', exact: true }).click()
    await composer.getByText(readOnlyName, { exact: true }).click()
    const readOnlyEditor = page.getByRole('textbox', { name: readOnlyPath, exact: true })
    await expect(readOnlyEditor).toHaveAttribute('aria-readonly', 'true')
    await expect(readOnlyEditor).toHaveAttribute('contenteditable', 'false')
    await openComment()
    await comment.fill('Inspect readonly source')
    await comment.press('ControlOrMeta+Enter')
    await expect(composer.getByText(`${readOnlyName} · L1`, { exact: true })).toBeVisible()
    await composer.press('ControlOrMeta+a')
    await composer.press('ControlOrMeta+c')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      `\`${readOnlyPath}:1\`\n\`\`\`\nconst readonly = "中文 🥟";\n\`\`\`\nInspect readonly source`
    )
    expect(await readFile(readOnlyPath, 'utf8')).toBe(readOnlySource)
    await context.screenshot('file-comments-readonly')
  } finally {
    await page.evaluate(
      async ({ preferences, clipboard, sessionId }) => {
        await window.api.preference.setMultiple({
          'chat.code.show_line_numbers': preferences.lineNumbers,
          'feature.agent.file_pane.auto_save': preferences.autoSave
        })
        await navigator.clipboard.writeText(clipboard)
        if (sessionId) {
          const deleted = (await window.api.ipcApi.request('ai.agent.session.delete_permanently', {
            sessionIds: [sessionId]
          })) as IpcResult<{ deletedIds: string[] }>
          if (!deleted.ok) throw new Error(deleted.error.message)
        }
      },
      { preferences, clipboard, sessionId: session?.id }
    )
  }
}
