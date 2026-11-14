import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { Locator, Page, TestInfo } from '@playwright/test'
import { v7 as uuidv7 } from 'uuid'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import type { IpcResult } from '../../../src/shared/ipc/errors/IpcError'
import type { OutputFor } from '../../../src/shared/ipc/types'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { revealVirtualized } from '../regression/helpers/virtualList'
import { expect, test } from './fixtures/electron.fixture'

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function deleteMessage(page: Page, row: Locator) {
  await row.hover()
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: en['message.message.delete.content'] })
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
}

test('protected Agent message shows guidance while an unbound message can be deleted', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  await page.evaluate(async (privacyVersion) => {
    await window.api.preference.set('app.language', 'en-US')
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.privacy.policy_version', privacyVersion)
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await expect(page.locator('[data-ui~="app.content"]')).toBeVisible({ timeout: 60_000 })

  const info = await page.evaluate(
    async () => (await window.api.ipcApi.request('app.get_info')) as IpcResult<OutputFor<'app.get_info'>>
  )
  expect(info.ok).toBe(true)
  if (!info.ok) throw new Error('app.get_info failed')
  const dbPath = join(info.data.appDataPath, 'Data', 'cherrystudio.sqlite')
  const suffix = randomUUID()
  const cases = [
    { name: `Protected ${suffix}`, text: `Protected message ${suffix}`, id: uuidv7(), binding: randomUUID() },
    { name: `Control ${suffix}`, text: `Control message ${suffix}`, id: uuidv7(), binding: null }
  ]
  const seeded = await page.evaluate(async (cases) => {
    const agents = await window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: '/agents' })
    if (agents.status !== 200) throw new Error(JSON.stringify(agents))
    const agent = (
      agents.data as { items: { id: string; name: string; configuration?: { builtin_role?: string } }[] }
    ).items.find((item) => item.configuration?.builtin_role === 'assistant')
    if (!agent) throw new Error('Built-in assistant is missing')
    const sessions: ((typeof cases)[number] & { sessionId: string })[] = []
    for (const item of cases) {
      const result = await window.api.dataApi.request({
        id: crypto.randomUUID(),
        method: 'POST',
        path: '/agent-sessions',
        body: { agentId: agent.id, name: item.name, workspace: { type: 'system' } }
      })
      if (result.status !== 201) throw new Error(JSON.stringify(result))
      sessions.push({ ...item, sessionId: (result.data as { id: string }).id })
    }
    await window.api.preference.setMultiple({
      'agent.session.display_mode': 'agent',
      'agent.session.position': 'right',
      'menu.presentation_mode': 'cherry'
    })
    return { agent, sessions }
  }, cases)

  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const item of seeded.sessions) {
        const root = db
          .prepare("SELECT id FROM agent_session_message WHERE session_id = ? AND role = 'root'")
          .get(item.sessionId)
        expect(root).toBeDefined()
        db.prepare(`INSERT INTO agent_session_message
          (id, session_id, role, parent_id, data, status, created_at, updated_at)
          VALUES (?, ?, 'user', ?, ?, 'success', ?, ?)`).run(
          item.id,
          item.sessionId,
          root!.id as string,
          JSON.stringify({ parts: [{ type: 'text', text: item.text, state: 'done' }] }),
          Date.now(),
          Date.now()
        )
        db.prepare('UPDATE agent_session SET active_node_id = ? WHERE id = ?').run(item.id, item.sessionId)
      }
      db.prepare("UPDATE agent_session_message SET data = json_set(data, '$.nativeSessionId', ?) WHERE id = ?").run(
        seeded.sessions[0].binding,
        seeded.sessions[0].id
      )
      const read = db.prepare(
        "SELECT session_id, role, status, json_extract(data, '$.nativeSessionId') AS binding FROM agent_session_message WHERE id = ?"
      )
      for (const item of seeded.sessions) {
        expect(read.get(item.id)).toMatchObject({
          session_id: item.sessionId,
          role: 'user',
          status: 'success',
          binding: item.binding
        })
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } finally {
    db.close()
  }
  await testInfo.attach('seeded-ids', {
    body: JSON.stringify(seeded.sessions, null, 2),
    contentType: 'application/json'
  })

  await page.reload()
  await selectSidebarApp(page, 'Work')
  const view = page.locator('[data-ui~="agent.view"]:visible')
  const showSidebar = view.getByRole('button', { name: 'Show Sidebar', exact: true })
  if (await showSidebar.isVisible()) await showSidebar.click()
  const agents = view.getByTestId('agent-entity-rail')
  const agent = agents
    .getByTestId('resource-entity-rail-row')
    .filter({ has: page.getByText(seeded.agent.name, { exact: true }) })
  await revealVirtualized(page, agents.getByRole('listbox'), agent)
  await agent.click()
  const list = page.getByTestId('resource-list-session').filter({ visible: true }).last()
  if (!(await list.getByRole('textbox', { name: 'Search tasks', exact: true }).isVisible())) {
    await page
      .getByRole('button', { name: /^Tasks/ })
      .last()
      .click()
  }
  const openSession = async (name: string) => {
    const row = list.getByTestId('agent-session-row').filter({ hasText: name })
    await revealVirtualized(page, list.getByRole('listbox'), row)
    await row.click()
  }
  const message = (text: string) => view.locator('[data-ui~="chat.message"]:visible').filter({ hasText: text })
  const readRow = (id: string) => {
    const connection = new DatabaseSync(dbPath, { readOnly: true })
    try {
      return connection.prepare('SELECT id FROM agent_session_message WHERE id = ?').get(id)
    } finally {
      connection.close()
    }
  }

  await openSession(seeded.sessions[0].name)
  const protectedRow = message(seeded.sessions[0].text)
  await expect(protectedRow).toBeVisible()
  await screenshot(page, testInfo, 'protected-conversation.png')
  await deleteMessage(page, protectedRow)
  const toast = page.getByRole('alert').filter({ hasText: en['message.error.agent_session_message_protected'] })
  await expect(toast.getByText(en['message.error.agent_session_message_protected'], { exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'protected-toast.png')
  for (const forbidden of [
    'Unknown error',
    'native input binding',
    'RESOURCE_LOCKED',
    'inputContextId',
    'nativeSessionId',
    'message.error.'
  ]) {
    await expect(toast).not.toContainText(forbidden)
  }
  await expect(protectedRow).toBeVisible()
  expect(readRow(seeded.sessions[0].id)).toBeDefined()

  await openSession(seeded.sessions[1].name)
  const controlRow = message(seeded.sessions[1].text)
  await expect(controlRow).toBeVisible()
  await deleteMessage(page, controlRow)
  await expect(controlRow).toHaveCount(0)
  await expect.poll(() => readRow(seeded.sessions[1].id)).toBeUndefined()
  await screenshot(page, testInfo, 'control-after-delete.png')
})
