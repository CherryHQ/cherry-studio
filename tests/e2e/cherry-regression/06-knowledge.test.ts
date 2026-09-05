import { expect, test } from './fixture'
import { CUSTOM_ASSISTANT, ensureCustomAssistant } from './assistants'
import { dismissOnboarding, selectSidebarApp } from './helpers'
import { EMBEDDING_PROVIDER, ensureEmbeddingProvider, ensureKnowledgeBase, KNOWLEDGE_NAME } from './knowledge'
import { closeSettings } from './models'

test('[K-01] 配置嵌入服务商并创建知识库 @knowledge-import', async ({ app, mainWindow }) => {
  let page = mainWindow
  await ensureEmbeddingProvider(app, page)
  await expect(page.getByRole('heading', { name: EMBEDDING_PROVIDER, exact: true, level: 1 })).toBeVisible()
  await expect(page.getByText(app.config.customEmbeddingProvider.model, { exact: true })).toBeVisible()
  await closeSettings(page)
  await ensureKnowledgeBase(app, page)

  await page.getByRole('button', { name: 'Recall Test', exact: true }).click()
  await page.getByRole('textbox').last().fill('What is the regression knowledge answer?')
  await page
    .getByRole('button', { name: /Search|Test|Send/ })
    .last()
    .click()
  await expect(page.getByRole('dialog').last()).toContainText('CHERRY_KNOWLEDGE_58597', { timeout: 2 * 60_000 })

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Knowledge Base')
  await expect(
    page.locator('[data-ui="knowledge.navigation"]').getByText(KNOWLEDGE_NAME, { exact: true })
  ).toBeVisible()
})

test('[K-02] 基于知识库问答并验证引用 @knowledge-qa', async ({ app, mainWindow: page }) => {
  await ensureEmbeddingProvider(app, page)
  await closeSettings(page)
  await ensureKnowledgeBase(app, page)

  await ensureCustomAssistant(app, page)
  await page.getByRole('button', { name: `Edit Assistant: ${CUSTOM_ASSISTANT}`, exact: true }).click()
  await page.getByRole('tab', { name: 'Knowledge', exact: true }).click()
  if (
    !(await page
      .getByText(KNOWLEDGE_NAME, { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Add knowledge base', exact: true }).click()
    await page.getByText(KNOWLEDGE_NAME, { exact: true }).click()
  }
  const assistantDialog = page.getByRole('dialog').last()
  await expect(assistantDialog.getByText(KNOWLEDGE_NAME, { exact: true })).toBeVisible()
  await assistantDialog.getByRole('button', { name: 'Close', exact: true }).click()

  const sendQuestion = async () => {
    const composer = page.locator('[data-ui="chat.composer"] [contenteditable="true"]').first()
    await composer.fill('What is the regression knowledge answer? Include the exact marker and cite the source file.')
    await page.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
    const quickPanel = page.getByTestId('quick-panel')
    await quickPanel.getByText('Knowledge Base', { exact: true }).click()
    await quickPanel.getByText(KNOWLEDGE_NAME, { exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
  }
  const marker = page.getByText('CHERRY_KNOWLEDGE_58597', { exact: false }).last()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await sendQuestion()
    const visible = await marker
      .waitFor({ state: 'visible', timeout: 2 * 60_000 })
      .then(() => true)
      .catch(() => false)
    if (visible) break
  }
  await expect(marker).toBeVisible()
  await expect(page.locator('body')).toContainText('ground-truth.txt')
  await expect(page.getByText(/\d+ citations?/i)).toBeVisible()
})
