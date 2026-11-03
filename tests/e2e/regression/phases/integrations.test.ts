import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { expect, test } from '../fixture'
import { selectSidebarApp } from '../helpers/navigation'
import { skillChatTrigger } from '../scenarios/skillChatTrigger'
import { toolSettings } from '../scenarios/toolSettings'

async function openSkillsPanel(page: Parameters<typeof selectSidebarApp>[0]): Promise<void> {
  const direct = page.locator('[data-ui~="chat.composer"]:visible').getByRole('button', { name: 'Skills', exact: true })
  await expect(direct).toBeVisible({ timeout: 30_000 })
  const manageSkills = page.getByText('Manage skills', { exact: true })
  await expect
    .poll(
      async () => {
        if (await manageSkills.isVisible().catch(() => false)) return true
        await direct.click()
        return manageSkills
          .waitFor({ state: 'visible', timeout: 2_000 })
          .then(() => true)
          .catch(() => false)
      },
      { timeout: 10_000 }
    )
    .toBe(true)
}

test(...caseDefinition('MP-139'), async ({ app, mainWindow: page }, testInfo) => {
  await toolSettings(app, page, testInfo)
})

test(...caseDefinition('MP-138'), async ({ app, mainWindow: page }, testInfo) => {
  await skillChatTrigger(app, page, testInfo)
})

// 这些 helper 只被尚未合并的用例使用（PR B 恢复用例时会再引用）。
void openSkillsPanel
