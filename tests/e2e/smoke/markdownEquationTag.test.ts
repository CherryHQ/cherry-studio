import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

import { expect, test } from './fixtures/electron.fixture'

test('numbered display math leaves a readable gap from the equation', async ({ mainWindow: page }) => {
  await page.evaluate(async (policyVersion) => {
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.privacy.policy_version': policyVersion,
      'app.onboarding.provider_setup.status': 'skipped'
    })
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload({ waitUntil: 'domcontentloaded' })

  const topicName = 'Equation numbering regression'
  const topicId = await page.evaluate(async (name) => {
    const topic = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: '/topics',
      body: { name }
    })
    if (topic.status !== 201) throw new Error(JSON.stringify(topic))
    const { id } = topic.data as { id: string }
    const message = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: `/topics/${id}/messages`,
      body: {
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: '$$\nE = mc^2 \\tag{2}\n$$' }] }
      }
    })
    if (message.status !== 201) throw new Error(JSON.stringify(message))
    return id
  }, topicName)
  await page.evaluate(
    (id) => window.api.ipcApi.request('navigation.open_route_in_main', { path: `/app/chat?topicId=${id}` }),
    topicId
  )
  await page.getByRole('button', { name: topicName, exact: false }).first().click()

  const equation = page.locator('[data-ui~="chat.view"]:visible .katex-display:visible').first()
  const number = equation.locator('.katex-html > .tag')
  await expect(number).toHaveText('(2)')
  await expect(number).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  // Measure the rendered boxes so a present-but-overlapping label still fails.
  await expect
    .poll(() =>
      equation.evaluate((root) => {
        const tag = root.querySelector('.katex-html > .tag')?.getBoundingClientRect()
        const body = Array.from(root.querySelectorAll('.katex-html > .base'), (part) => part.getBoundingClientRect())
        if (!tag || !body.some((box) => box.top < tag.bottom && box.bottom > tag.top)) return 0
        return tag.left - Math.max(...body.map((box) => box.right))
      })
    )
    .toBeGreaterThan(0)
})
