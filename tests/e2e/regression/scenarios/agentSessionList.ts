import { writeFile } from 'node:fs/promises'

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'

import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Pin } from '@shared/data/types/pin'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { dismissOnboarding, selectSidebarApp } from '../helpers/navigation'
import { revealVirtualized } from '../helpers/virtualList'
import type { RegressionApp } from '../RegressionApp'

export async function agentSessionList(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const handleGatewayPrompt = async () => {
    await page.addLocatorHandler(
      page.getByRole('dialog').filter({ hasText: 'Enable the API Gateway?' }),
      async (dialog) => {
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
    )
  }
  await handleGatewayPrompt()
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    mode: await window.api.preference.get('agent.session.display_mode'),
    position: await window.api.preference.get('agent.session.position'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const response = await page.evaluate(() =>
    window.api.dataApi.request({ id: 'mp54-agents', method: 'GET', path: '/agents' })
  )
  expect(response.status).toBe(200)
  const agent = (response.data as { items: AgentEntity[] }).items.find(
    (item) => item.configuration?.builtin_role === 'assistant'
  )
  expect(agent, 'Built-in assistant must exist').toBeDefined()
  const sessions: AgentSessionEntity[] = []
  const names = ['MP54 Orchid plans', 'MP54 Cedar notes', 'MP54 Maple review']
  const list = () => page.getByTestId('resource-list-session').filter({ visible: true }).last()
  const row = (name: string) => list().getByTestId('agent-session-row').filter({ hasText: name })
  const pins = async () => {
    const result = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp54-pins', method: 'GET', path: '/pins', params: { entityType: 'session' } })
    )
    expect(result.status).toBe(200)
    return (result.data as Pin[]).filter((pin) => sessions.some((session) => session.id === pin.entityId))
  }
  const assertUnique = async () => {
    for (const name of names) {
      await revealVirtualized(page, list().getByRole('listbox'), row(name))
      await expect(row(name)).toHaveCount(1)
    }
    const result = await page.evaluate(
      (ids) =>
        window.api.dataApi.request({ id: 'mp54-sessions', method: 'GET', path: '/agent-sessions', params: { ids } }),
      sessions.map((session) => session.id)
    )
    expect(result.status).toBe(200)
    const items = (result.data as { items: AgentSessionEntity[] }).items
    expect(items.map((item) => item.id).sort()).toEqual(sessions.map((session) => session.id).sort())
  }
  const drag = async (source: Locator, target: Locator, after = false) => {
    await revealVirtualized(page, list().getByRole('listbox'), source)
    const from = await source.boundingBox()
    expect(from).not.toBeNull()
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
    await page.mouse.down()
    try {
      await page.mouse.move(from!.x + from!.width / 2 + 12, from!.y + from!.height / 2, { steps: 5 })
      await expect(page.locator('[data-dragging="true"]').first()).toBeVisible({ timeout: 3000 })
      await revealVirtualized(page, list().getByRole('listbox'), target)
      const to = await target.boundingBox()
      expect(to).not.toBeNull()
      await page.mouse.move(to!.x + to!.width / 2, to!.y + (after ? to!.height - 3 : 3), { steps: 20 })
      await page.waitForTimeout(300)
      await testInfo.attach('MP-54 drag target state', {
        body: JSON.stringify(
          await page.locator('[data-drop-indicator]').evaluateAll((indicators) =>
            indicators.map((indicator) => ({
              position: indicator.getAttribute('data-drop-indicator'),
              target: (indicator.parentElement as HTMLElement | null)?.innerText
            }))
          )
        ),
        contentType: 'application/json'
      })
    } finally {
      await page.mouse.up()
    }
  }

  try {
    // Seed real sessions only; no model response or successful UI outcome is mocked.
    for (const name of names) {
      const created = await page.evaluate(
        ({ agentId, name }) =>
          window.api.dataApi.request({
            id: 'mp54-create',
            method: 'POST',
            path: '/agent-sessions',
            body: { agentId, name, workspace: { type: 'system' } }
          }),
        { agentId: agent!.id, name }
      )
      expect(created.status).toBe(201)
      sessions.push(created.data as AgentSessionEntity)
    }
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'agent.session.display_mode': 'agent',
        'agent.session.position': 'right',
        'menu.presentation_mode': 'cherry'
      })
    )
    await page.reload()
    await selectSidebarApp(page, 'Work')
    await page.locator('[data-ui~="agent.view"]:visible').getByText(agent!.name, { exact: true }).first().click()
    if (!(await list().getByRole('textbox', { name: 'Search tasks', exact: true }).isVisible())) {
      await page
        .getByRole('button', { name: /^Tasks/ })
        .last()
        .click()
    }
    await expect(list().getByRole('textbox', { name: 'Search tasks', exact: true })).toBeVisible()
    const search = list().getByRole('textbox', { name: 'Search tasks', exact: true })
    await assertUnique()
    await search.fill('Orchid')
    await expect(row(names[0])).toBeVisible()
    await expect(row(names[1])).toHaveCount(0)
    await expect(row(names[2])).toHaveCount(0)
    await screenshot('MP-54 title search result')
    await expect
      .soft(
        row(names[0]).locator('mark, [data-highlighted="true"], .search-highlight'),
        'Search match must be highlighted'
      )
      .toContainText('Orchid', { timeout: 2000 })
    await search.fill('MP54-no-such-task-928173')
    await expect(list().getByTestId('agent-session-row')).toHaveCount(0)
    await expect(list().getByText('No tasks', { exact: true })).toBeVisible()
    await screenshot('MP-54 no matching tasks empty state')
    await search.fill('')
    await assertUnique()

    await row(names[0]).hover()
    await row(names[0]).getByRole('button', { name: 'Pin task', exact: true }).click()
    await expect(row(names[0]).getByRole('button', { name: 'Unpin task', exact: true })).toBeVisible()
    await expect(list().getByTestId('agent-session-row').first()).toContainText(names[0])
    const today = list().getByRole('button', { name: 'Today', exact: true })
    await expect(today).toHaveAttribute('aria-expanded', 'true')
    await today.click()
    await expect(today).toHaveAttribute('aria-expanded', 'false')
    await expect(row(names[1])).toHaveCount(0)
    await expect(row(names[0])).toBeVisible()
    await today.click()
    await expect(today).toHaveAttribute('aria-expanded', 'true')
    await assertUnique()
    await row(names[1]).hover()
    await row(names[1]).getByRole('button', { name: 'Pin task', exact: true }).click()
    await expect.poll(async () => (await pins()).length).toBe(2)

    await row(names[0]).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Session position', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Left', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.api.preference.get('agent.session.position'))).toBe('left')
    await testInfo.attach('MP-54 grouped panel layout', {
      body: JSON.stringify(
        await page.evaluate(async () => ({
          position: await window.api.preference.get('agent.session.position'),
          mode: await window.api.preference.get('agent.session.display_mode'),
          panels: [...document.querySelectorAll('[data-testid="resource-list-session"]')].map((panel) => ({
            visible: panel.getClientRects().length > 0,
            width: panel.getBoundingClientRect().width,
            groupHeaders: panel.querySelectorAll('[data-ui~="chat.group-header"]').length,
            searchInputs: panel.querySelectorAll('input').length
          }))
        })),
        null,
        2
      ),
      contentType: 'application/json'
    })
    const agentHeader = list().locator('[data-ui~="chat.group-header"]').filter({ hasText: agent!.name }).first()
    await revealVirtualized(page, list().getByRole('listbox'), agentHeader)
    await agentHeader.hover()
    const expand = agentHeader.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await assertUnique()
    const before = (await pins()).map((pin) => pin.entityId)
    const desired = [...before].reverse()
    const firstName = sessions.find((session) => session.id === before[0])!.name
    const secondName = sessions.find((session) => session.id === before[1])!.name
    await drag(row(secondName), row(firstName))
    await screenshot('MP-54 pinned sessions after drag reorder')
    await expect.soft
      .poll(async () => (await pins()).map((pin) => pin.entityId), {
        timeout: 3000,
        message: '#21948 pinned drag must change custom order'
      })
      .toEqual(desired)
    await expect.soft(list().getByTestId('agent-session-row').nth(0)).toContainText(secondName, { timeout: 2000 })

    page = await app.restart('authenticated')
    await handleGatewayPrompt()
    await dismissOnboarding(page)
    await selectSidebarApp(page, 'Work')
    await expect.soft
      .poll(async () => (await pins()).map((pin) => pin.entityId), {
        timeout: 3000,
        message: '#21948 custom pin order must survive full restart'
      })
      .toEqual(desired)
    await expect.soft(list().getByTestId('agent-session-row').first()).toContainText(secondName, { timeout: 2000 })
    const restartedHeader = list().locator('[data-ui~="chat.group-header"]').filter({ hasText: agent!.name }).first()
    await revealVirtualized(page, list().getByRole('listbox'), restartedHeader)
    await restartedHeader.hover()
    const restartedExpand = restartedHeader.getByRole('button', { name: 'Expand', exact: true })
    if (await restartedExpand.isVisible()) await restartedExpand.click()
    await assertUnique()
    await drag(row(secondName), row(names[2]), true)
    await assertUnique()
    await expect
      .soft(
        row(secondName).getByRole('button', { name: 'Pin task', exact: true }),
        'Dragging outside the pinned area must unpin the session'
      )
      .toBeVisible({ timeout: 2000 })
    await drag(row(secondName), row(firstName))
    await assertUnique()
    await expect(row(secondName).getByRole('button', { name: 'Unpin task', exact: true })).toBeVisible()
    await expect.poll(async () => (await pins()).length).toBe(2)
    await screenshot('MP-54 restart and drag out back uniqueness')
  } finally {
    await page.evaluate(
      async ({ preferences, ids }) => {
        await window.api.preference.setMultiple({
          'agent.session.display_mode': preferences.mode,
          'agent.session.position': preferences.position,
          'menu.presentation_mode': preferences.menuMode
        })
        if (ids.length) {
          const deleted = (await window.api.ipcApi.request('ai.agent.session.delete_permanently', {
            sessionIds: ids
          })) as IpcResult<{ deletedIds: string[] }>
          if (!deleted.ok || ids.some((id) => !deleted.data.deletedIds.includes(id))) {
            throw new Error('cleanup left case sessions active')
          }
        }
      },
      { preferences, ids: sessions.map((session) => session.id) }
    )
  }
}
