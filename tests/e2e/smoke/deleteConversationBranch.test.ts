import { mkdir, rm } from 'node:fs/promises'

import { _electron as electron, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import type { CreateMessageDto } from '../../../src/shared/data/api/schemas/messages'
import type { DataRequest, DataResponse } from '../../../src/shared/data/api/types'
import type { Message, TreeResponse } from '../../../src/shared/data/types/message'
import type { Topic } from '../../../src/shared/data/types/topic'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test as base } from './fixtures/electron.fixture'

const ASSISTANT = 'Branch deletion smoke assistant'
const TOPIC = 'Delete one exclusive conversation branch'

function launch(profile: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile }
  delete env.ELECTRON_RENDERER_URL
  return electron.launch({
    args: ['.'],
    env: Object.fromEntries(Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined)),
    timeout: 60_000
  })
}

const test = base.extend({
  electronApp: async ({}, provideApp, testInfo) => {
    const profile = testInfo.outputPath('profile')
    await mkdir(profile, { recursive: true })
    const app = await launch(profile)
    try {
      await provideApp(app)
    } finally {
      try {
        if (app.process()?.exitCode === null) await app.close()
      } catch {
        // The test owns both app lifetimes and may already have closed this one.
      } finally {
        await rm(profile, { recursive: true, force: true })
      }
    }
  }
})

async function mainWindow(app: ElectronApplication) {
  let page: Page | undefined
  await expect
    .poll(
      async () => {
        for (const window of app.windows()) {
          if ((await window.title()) === 'Cherry Studio') {
            page = window
            return true
          }
        }
        return false
      },
      { timeout: 60_000 }
    )
    .toBe(true)
  await page!.waitForSelector('#root', { state: 'attached', timeout: 60_000 })
  await page!.waitForLoadState('domcontentloaded')
  return page!
}

async function ready(page: Page) {
  await page.evaluate(async (policyVersion) => {
    await window.api.preference.set('app.privacy.policy_version', policyVersion)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 60_000 })
  await expect(
    page.getByRole('dialog', { name: en['privacy_policy_update.title'], exact: true }),
    'Setup failure: privacy policy modal reopened after setting the current policy version'
  ).toHaveCount(0)
}

function request<T>(page: Page, method: DataRequest['method'], path: string, params?: DataRequest['params']) {
  return page.evaluate((req) => window.api.dataApi.request(req), {
    id: crypto.randomUUID(),
    method,
    path,
    params
  }) as Promise<DataResponse<T>>
}

async function openTopic(page: Page, seeded: { assistantId: string; topicId: string }) {
  await page.evaluate(({ assistantId, topicId }) => {
    window.dispatchEvent(
      new CustomEvent('cherry:open-main-route', {
        cancelable: true,
        detail: { path: `/app/chat?assistantId=${assistantId}&topicId=${topicId}` }
      })
    )
  }, seeded)
  // The resource list can mount the same row twice, so pin the locator to the first visible match.
  const topicRow = page
    .getByTestId('topic-list-row')
    .filter({ has: page.getByText(TOPIC, { exact: true }) })
    .first()
  const assistantButton = page.getByRole('button', { name: ASSISTANT, exact: true }).first()
  await expect(assistantButton).toBeVisible({ timeout: 30_000 })
  for (let attempt = 0; attempt < 4 && !(await topicRow.isVisible()); attempt += 1) {
    await assistantButton.click()
    await page.waitForTimeout(500)
  }
  await expect(topicRow).toBeVisible({ timeout: 30_000 })
  await topicRow.click()
}

async function prepareFlowCanvas(page: Page) {
  await page.locator('.react-flow').getByRole('button', { name: 'Fit View', exact: true }).click()
  // The floating minimap panel covers nodes and is not part of the behaviour under test.
  await page.addStyleTag({ content: '.react-flow .react-flow__minimap { display: none !important; }' })
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.bringToFront()
  await page.waitForTimeout(250)
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test('deletes only a branch suffix after confirmation and keeps survivors across a same-profile restart', async ({
  electronApp
}, testInfo) => {
  test.setTimeout(180_000)
  const page = await mainWindow(electronApp)
  await ready(page)
  const seeded = await page.evaluate(
    async ({ assistantName, topicName }) => {
      const assistant = await window.api.dataApi.request({
        id: 'branch-seed-assistant',
        method: 'POST',
        path: '/assistants',
        body: { name: assistantName }
      })
      if (assistant.status !== 201) throw new Error(JSON.stringify(assistant))
      const assistantId = (assistant.data as { id: string }).id
      const topic = await window.api.dataApi.request({
        id: 'branch-seed-topic',
        method: 'POST',
        path: '/topics',
        body: { name: topicName, assistantId }
      })
      if (topic.status !== 201) throw new Error(JSON.stringify(topic))
      const topicId = (topic.data as { id: string }).id
      async function create(
        marker: string,
        role: CreateMessageDto['role'],
        parentId: string | null,
        siblingsGroupId = 0
      ) {
        const body: CreateMessageDto = {
          parentId,
          role,
          siblingsGroupId,
          status: 'success',
          setAsActive: false,
          data: { parts: [{ type: 'text', text: `Branch smoke ${marker}`, state: 'done' }] }
        }
        const result = await window.api.dataApi.request({
          id: `branch-seed-${marker}`,
          method: 'POST',
          path: `/topics/${topicId}/messages`,
          body
        })
        if (result.status !== 201) throw new Error(JSON.stringify(result))
        return result.data as Message
      }
      const F1 = await create('F1 shared question', 'user', null)
      const F2 = await create('F2 shared answer', 'assistant', F1.id)
      const O1 = await create('O1 retained question', 'user', F2.id, 101)
      const O2 = await create('O2 retained answer', 'assistant', O1.id)
      const R1 = await create('R1 retained alternative', 'user', F2.id, 102)
      const A = await create('A target question', 'user', F2.id)
      const B = await create('B target answer', 'assistant', A.id)
      const L = await create('L target leaf', 'user', B.id)
      const active = await window.api.dataApi.request({
        id: 'branch-seed-active',
        method: 'PUT',
        path: `/topics/${topicId}/active-node`,
        body: { nodeId: L.id }
      })
      if (active.status !== 200) throw new Error(JSON.stringify(active))
      const tree = await window.api.dataApi.request({
        id: 'branch-seed-tree',
        method: 'GET',
        path: `/topics/${topicId}/tree`
      })
      if (tree.status !== 200) throw new Error(JSON.stringify(tree))
      return {
        assistantId,
        topicId,
        rootId: (tree.data as TreeResponse).rootId!,
        retained: [F1, F2, O1, O2, R1],
        removed: [A, B, L],
        leafId: L.id
      }
    },
    { assistantName: ASSISTANT, topicName: TOPIC }
  )

  for (const rows of [seeded.retained, seeded.removed]) {
    for (const [index, row] of rows.entries()) {
      const response = await request<Message>(page, 'GET', `/messages/${row.id}`)
      expect(response.status).toBe(200)
      rows[index] = response.data!
    }
  }

  await openTopic(page, seeded)
  await page.getByRole('button', { name: 'Branch Management', exact: true }).click()
  await prepareFlowCanvas(page)
  const leaf = page.locator(`.react-flow [data-message-id="${seeded.leafId}"]`)
  await expect(leaf).toBeVisible()
  await leaf.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete branch', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this branch?' })
  await expect(dialog).toBeVisible()
  await screenshot(page, testInfo, 'branch-delete-confirmation.png')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  for (const row of seeded.removed) {
    const response = await request<Message>(page, 'GET', `/messages/${row.id}`)
    expect(response.status).toBe(200)
    expect(response.data).toEqual(row)
  }

  await prepareFlowCanvas(page)
  await leaf.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete branch', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete branch', exact: true }).click()
  await expect(dialog).toBeHidden()

  async function assertSurvivors(currentPage: Page) {
    for (const row of seeded.removed) {
      const result = await request<Message>(currentPage, 'GET', `/messages/${row.id}`)
      expect(result.status).toBe(404)
      expect(result.error?.code).toBe('NOT_FOUND')
    }
    const treeResult = await request<TreeResponse>(currentPage, 'GET', `/topics/${seeded.topicId}/tree`)
    expect(treeResult.status).toBe(200)
    const tree = treeResult.data!
    const nodes = [...tree.nodes, ...tree.siblingsGroups.flatMap((group) => group.nodes)]
    expect(nodes.map((node) => node.id).sort()).toEqual(seeded.retained.map((row) => row.id).sort())
    expect(tree.rootId).toBe(seeded.rootId)
    const topic = await request<Topic>(currentPage, 'GET', `/topics/${seeded.topicId}`)
    expect(topic.status).toBe(200)
    expect(topic.data?.name).toBe(TOPIC)
    const root = await request<Message>(currentPage, 'GET', `/messages/${seeded.rootId}`)
    expect(root.status).toBe(200)
    expect(root.data).toMatchObject({ role: 'root', parentId: null, topicId: seeded.topicId })
    for (const row of seeded.retained) {
      const result = await request<Message>(currentPage, 'GET', `/messages/${row.id}`)
      expect(result.status).toBe(200)
      expect(result.data).toEqual(row)
    }
    expect(seeded.retained.map((row) => row.id)).toContain(topic.data?.activeNodeId)
    expect(tree.activeNodeId).toBe(topic.data?.activeNodeId)
    expect(seeded.retained.some((row) => row.parentId === tree.activeNodeId)).toBe(false)
    const path = await request<Message[]>(currentPage, 'GET', `/topics/${seeded.topicId}/path`, {
      nodeId: tree.activeNodeId
    })
    expect(path.status).toBe(200)
    const expectedPath =
      tree.activeNodeId === seeded.retained[3].id
        ? seeded.retained.slice(0, 4)
        : [seeded.retained[0], seeded.retained[1], seeded.retained[4]]
    expect(path.data?.map((row) => ({ id: row.id, data: row.data }))).toEqual(
      expectedPath.map((row) => ({ id: row.id, data: row.data }))
    )
    const chat = currentPage.locator('[data-ui~="chat.view"]:visible')
    const rows = chat.locator('[data-ui~="chat.message"]')
    for (const row of expectedPath) {
      const text = row.data.parts?.find((part) => part.type === 'text')
      if (text?.type === 'text') await expect(rows.getByText(text.text, { exact: true })).toBeVisible()
    }
  }

  await assertSurvivors(page)
  await expect(leaf).toHaveCount(0)
  await screenshot(page, testInfo, 'branch-delete-survivors.png')
  await electronApp.close()
  const restarted = await launch(testInfo.outputPath('profile'))
  try {
    const restartedPage = await mainWindow(restarted)
    await ready(restartedPage)
    await openTopic(restartedPage, seeded)
    await assertSurvivors(restartedPage)
    const shortcut = restartedPage.getByRole('button', { name: 'Branch Management', exact: true })
    if ((await shortcut.getAttribute('aria-pressed')) !== 'true') await shortcut.click()
    await prepareFlowCanvas(restartedPage)
    await expect(restartedPage.locator(`.react-flow [data-message-id="${seeded.retained[4].id}"]`)).toBeVisible()
    for (const row of seeded.removed) {
      await expect(restartedPage.locator(`.react-flow [data-message-id="${row.id}"]`)).toHaveCount(0)
    }
    await screenshot(restartedPage, testInfo, 'branch-delete-after-restart.png')
  } finally {
    if (restarted.process()?.exitCode === null) await restarted.close()
  }
})
