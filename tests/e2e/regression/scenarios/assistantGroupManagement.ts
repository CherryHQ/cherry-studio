import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function assistantGroupManagement(
  app: RegressionApp,
  mainWindow: Page,
  testInfo: TestInfo
): Promise<void> {
  let page = mainWindow
  const names = [app.resourceName('QA group assistant A'), app.resourceName('QA group assistant B')]
  const assistantIds: string[] = []
  let groupId: string | undefined
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const readAssistants = async () => {
    const result = await page.evaluate(async (ids) => {
      return Promise.all(
        ids.map((id) => window.api.dataApi.request({ id: 'mp24-read', method: 'GET', path: `/assistants/${id}` }))
      )
    }, assistantIds)
    return result.map((response) => {
      expect(response.status).toBe(200)
      return AssistantSchema.parse(response.data)
    })
  }
  const group = () => page.getByRole('button', { name: /^QA 分组\s*\d+$/ })
  const card = (name: string) => page.getByLabel(name, { exact: true })
  const openLibrary = async () => {
    await selectSidebarApp(page, 'Chat')
    await page.getByRole('button', { name: 'Display mode', exact: true }).first().click()
    await page.getByText('Manage Assistants', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Group', exact: true })).toBeVisible()
  }
  const restart = async () => {
    const before = app.record
    page = await app.restart()
    expect(app.record.electronPid).not.toBe(before.electronPid)
    expect(app.record.restartCount).toBe(before.restartCount + 1)
    expect(app.record.profile).toBe(before.profile)
    await openLibrary()
  }

  try {
    for (const name of names) {
      const response = await page.evaluate(
        (name) =>
          window.api.dataApi.request({ id: 'mp24-create', method: 'POST', path: '/assistants', body: { name } }),
        name
      )
      expect(response.status).toBe(201)
      const assistant = AssistantSchema.parse(response.data)
      expect(assistant.groupId).toBeNull()
      assistantIds.push(assistant.id)
    }
    await page.reload()
    await openLibrary()
    for (const name of names) await expect(card(name)).toBeVisible()
    await page.getByRole('button', { name: 'Group', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New Group', exact: true })
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('QA 分组')
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog).toBeHidden()
    const response = await page.evaluate(() =>
      window.api.dataApi.request({
        id: 'mp24-groups',
        method: 'GET',
        path: '/groups',
        params: { entityType: 'assistant' }
      })
    )
    expect(response.status).toBe(200)
    const created = (response.data as { id: string; name: string }[]).filter(({ name }) => name === 'QA 分组')
    expect(created).toHaveLength(1)
    groupId = created[0].id
    if (!(await group().isVisible())) await page.getByRole('button', { name: 'All groups', exact: true }).click()
    await expect(group()).toHaveText('QA 分组0')
    await screenshot('MP-24 new empty group and two assistants')

    for (const [index, name] of names.entries()) {
      await card(name).dragTo(group())
      await screenshot(`MP-24 assistant ${index + 1} after drag into group`)
      await expect
        .poll(async () => (await readAssistants())[index].groupId, {
          message: 'Dragging an assistant into QA 分组 must persist its group membership'
        })
        .toBe(groupId)
      await expect(group()).toHaveText(`QA 分组${index + 1}`)
    }
    await group().click()
    for (const name of names) await expect(card(name)).toBeVisible()
    const groupedCards = page
      .locator('[data-ui~="resource-catalog.card.button"]')
      .filter({ has: page.getByText('QA 分组', { exact: true }) })
    await expect(groupedCards).toHaveCount(2)
    await expect(groupedCards.filter({ has: page.getByText(names[0], { exact: true }) })).toHaveCount(1)
    await expect(groupedCards.filter({ has: page.getByText(names[1], { exact: true }) })).toHaveCount(1)
    await screenshot('MP-24 two assistants in group')

    // Clicking the selected group clears its filter; it does not collapse the group. The library
    // then lists every assistant again, and the selected state is the only thing that goes away.
    await group().click()
    await expect(
      group(),
      'Clicking the selected group must clear its filter instead of collapsing the group'
    ).not.toHaveClass(/border-border-selected/)
    for (const name of names) await expect(card(name)).toBeVisible()
    await screenshot('MP-24 cleared group filter keeps its name and shows every assistant')
    await group().click()
    await expect(group()).toHaveClass(/border-border-selected/)
    for (const name of names) await expect(card(name)).toBeVisible()

    await restart()
    await expect(group()).toHaveText('QA 分组2')
    expect((await readAssistants()).map(({ groupId }) => groupId)).toEqual([groupId, groupId])
    await group().click()
    for (const name of names) await expect(card(name)).toBeVisible()
    await screenshot('MP-24 group and membership survive restart')

    await group().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete Group', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Delete Group', exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click()
    await expect(group()).toHaveCount(0)
    expect((await readAssistants()).map(({ id, name, groupId }) => ({ id, name, groupId }))).toEqual(
      assistantIds.map((id, index) => ({ id, name: names[index], groupId: null }))
    )
    for (const name of names) await expect(card(name)).toBeVisible()
    await screenshot('MP-24 deleting group preserves both ungrouped assistants')
    await restart()
    await expect(group()).toHaveCount(0)
    expect((await readAssistants()).map(({ groupId }) => groupId)).toEqual([null, null])
    for (const name of names) await expect(card(name)).toBeVisible()
    await screenshot('MP-24 deletion and default membership survive restart')
  } finally {
    page = await app.mainWindow()
    await page.evaluate(
      async ({ assistantIds, groupId }) => {
        if (groupId)
          await window.api.dataApi.request({ id: 'mp24-cleanup-group', method: 'DELETE', path: `/groups/${groupId}` })
        for (const assistantId of assistantIds) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
      },
      { assistantIds, groupId }
    )
  }
}
