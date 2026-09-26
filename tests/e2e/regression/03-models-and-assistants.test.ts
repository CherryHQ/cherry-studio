import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { customAssistantName, ensureCustomAssistant } from './assistants'
import { selectChatModel, sendChatMarker } from './chat'
import { expect, test } from './fixture'
import { CUSTOM_CHAT_PROVIDER, ensureCustomChatProvider } from './models'
import { dismissOnboarding, selectSidebarApp } from './navigation'
import { closeSettings, openSettingsSection } from './settings'

test(...caseDefinition('M-02'), async ({ app, mainWindow }) => {
  let page = mainWindow
  await ensureCustomChatProvider(app, page)
  await expect(page.getByText(CUSTOM_CHAT_PROVIDER, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(app.config.customProvider.chatModel, { exact: true }).last()).toBeVisible()

  await closeSettings(page)
  await selectChatModel(page, app.config.customProvider.chatModel)
  await sendChatMarker(
    page,
    'Reply with exactly CUSTOM_PROVIDER_CHAT_PASS and nothing else.',
    'CUSTOM_PROVIDER_CHAT_PASS'
  )

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await openSettingsSection(page, 'Model Provider')
  await expect(page.getByText(CUSTOM_CHAT_PROVIDER, { exact: true }).first()).toBeVisible()
})

test(...caseDefinition('M-03'), async ({ app, mainWindow: page }) => {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const providerId = `regression-model-scroll-${Date.now()}`
  const providerName = app.resourceName('Model scrolling')
  const groupName = app.resourceName('Scroll group')
  const created = await page.evaluate(
    ({ providerId, providerName }) =>
      window.api.dataApi.request({
        id: `${providerId}-create`,
        method: 'POST',
        path: '/providers',
        body: { providerId, name: providerName }
      }),
    { providerId, providerName }
  )
  expect(created.status).toBe(201)

  try {
    // Seed persisted inputs; scrolling and all assertions go through the real settings UI.
    const seeded = await page.evaluate(
      ({ providerId, groupName }) =>
        window.api.dataApi.request({
          id: `${providerId}-models`,
          method: 'POST',
          path: '/models',
          body: Array.from({ length: 160 }, (_, index) => ({
            providerId,
            modelId: `scroll-${String(index).padStart(3, '0')}`,
            name: `Scroll model ${String(index).padStart(3, '0')}`,
            group: groupName
          }))
        }),
      { providerId, groupName }
    )
    expect(seeded.status).toBe(201)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.reload()

    await openSettingsSection(page, 'Model Provider')
    await page.getByPlaceholder('Search Providers...', { exact: true }).fill(providerName)
    await page.getByTestId(`provider-list-item-${providerId}`).click()
    const detail = page.getByTestId('provider-detail-shell')
    const list = detail.getByTestId('provider-model-list').getByRole('list')
    const firstModel = list.getByText('Scroll model 000', { exact: true })
    const laterModel = list.getByText('Scroll model 060', { exact: true })
    const group = list.getByRole('button', { name: new RegExp(`^${groupName}`) })
    await expect(firstModel).toBeInViewport()
    await expect(group).toBeInViewport()
    await expect(laterModel).not.toBeInViewport()

    const listBox = await list.boundingBox()
    const detailBox = await detail.boundingBox()
    if (!listBox || !detailBox) throw new Error('Provider model list has no visible layout')
    const wheelStep = Math.floor(detailBox.height / 2)
    const pointerY = detailBox.y + detailBox.height / 2
    const outsideX = listBox.x - 12
    expect(outsideX).toBeGreaterThan(detailBox.x)
    await page.mouse.move(outsideX, pointerY)
    await expect(async () => {
      await page.mouse.wheel(0, wheelStep)
      await expect(laterModel).toBeInViewport({ timeout: 500 })
    }).toPass({ timeout: 15_000 })

    await expect(group).not.toBeInViewport()
    await expect(firstModel).not.toBeAttached()

    await page.mouse.move(listBox.x + listBox.width / 2, pointerY)
    await expect(async () => {
      await page.mouse.wheel(0, -wheelStep)
      await expect(firstModel).toBeInViewport({ timeout: 500 })
      await expect(group).toBeInViewport({ timeout: 500 })
    }).toPass({ timeout: 15_000 })
  } finally {
    const removed = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({ id: `${providerId}-delete`, method: 'DELETE', path: `/providers/${providerId}` }),
      providerId
    )
    expect(removed.status).toBe(204)
    const providerSearch = page.getByPlaceholder('Search Providers...', { exact: true })
    if (await providerSearch.isVisible()) await providerSearch.fill('')
    await page.setViewportSize(viewport)
  }
})

test(...caseDefinition('C-01'), async ({ app, mainWindow: page }) => {
  await ensureCustomAssistant(app, page)
  await sendChatMarker(page, 'In one sentence, what is two plus two?', 'ASSISTANT_PROMPT_PASS', false)

  const restarted = await app.restart('authenticated')
  await dismissOnboarding(restarted)
  await selectSidebarApp(restarted, 'Chat')
  const assistantList = restarted.locator('[data-ui="chat.view"]:visible').getByRole('listbox').first()
  await expect(assistantList).toBeVisible()
  await assistantList.getByText(customAssistantName(app), { exact: true }).first().click({ noWaitAfter: true })
  await expect(restarted.getByText('ASSISTANT_PROMPT_PASS').last()).toBeVisible()
})
