import { expect, type Page } from '@playwright/test'

import { selectVisibleModel } from './models'
import { selectSidebarApp } from './navigation'

export async function selectChatModel(page: Page, model: string): Promise<void> {
  await selectSidebarApp(page, 'Chat')
  await page.getByRole('button', { name: 'Selected models', exact: true }).click()
  await selectVisibleModel(page, model)
  await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toBeVisible()
}

export async function sendChatMarker(page: Page, prompt: string, marker: string, exact = true): Promise<void> {
  const messages = page.locator('[data-ui~="chat.message"][data-message-id]:visible')
  const previousIds = await messages.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-message-id'))
  )
  const composer = page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  await composer.fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const excludePrevious = previousIds.map((id) => `:not([data-message-id="${id}"])`).join('')
  const response = page
    .locator(`[data-ui~="chat.message"][data-message-id]${excludePrevious}:visible`)
    .filter({ has: page.locator('.message-assistant') })
    .last()
  await expect(response.getByText(marker, { exact })).toBeVisible({ timeout: 2 * 60_000 })
  const id = await response.getAttribute('data-message-id')
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const response = await window.api.dataApi.request({
            id: `regression-message-${Date.now()}`,
            method: 'GET',
            path: `/messages/${id}`
          })
          return (response.data as { status?: string } | undefined)?.status
        }, id),
      { timeout: 2 * 60_000 }
    )
    .toBe('success')
}
