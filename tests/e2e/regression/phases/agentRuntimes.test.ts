import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { test } from '../fixture'
import { ensureCustomChatProvider } from '../helpers/models'
import { closeSettings } from '../helpers/settings'
async function ensureAgentModel(
  app: Parameters<typeof ensureCustomChatProvider>[0],
  page: Parameters<typeof ensureCustomChatProvider>[1]
): Promise<{ model: string; providerId: string }> {
  // The provider id scopes every model picker: another enabled provider exposing
  // the same raw model id must never be selected instead of the configured one.
  const providerId = await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  return { model: app.config.customProvider.chatModel, providerId }
}
import { scheduledTasks } from '../scenarios/scheduledTasks'
import { workspaceLifecycle } from '../scenarios/workspaceLifecycle'

test(...caseDefinition('MP-53'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(5 * 60_000)
  await workspaceLifecycle(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-58'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(8 * 60_000)
  await scheduledTasks(app, mainWindow, testInfo)
})

// 这些 helper 只被尚未合并的用例使用（PR B 恢复用例时会再引用）。
void ensureAgentModel
