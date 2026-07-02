import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage, E2E_ASSISTANT_MODEL_ID } from '../../pages/chat-agent.page'
import { waitForAppReady } from '../../utils/wait-helpers'

const TARGET_BASE = 'E2E_Test_KB'

/**
 * Spec (full · live: llm): a KB-equipped assistant uses `kb_list`'s outline mode — passing
 * `baseId` to get one base's folder/document tree, as opposed to its list mode (omitted `baseId`,
 * which just enumerates the user's bases). Both modes share the same wire tool name (`kb_list` is
 * inline, `defer: 'never'`), so telling them apart needs the call's own arguments
 * (`data-tool-args`, see `toolArgsFor`): outline mode's `baseId` is a real id, list mode's is
 * `null` (kb_list's strict schema keeps `baseId` in `required` with `.nullable()`, see
 * `kbListStrictInputSchema`). We assert only that outline mode fired at least once, never on the
 * returned tree's shape/content.
 */
test.describe('Knowledge · assistant outlines a base via kb_list (agentic)', { tag: '@full' }, () => {
  test('assistant calls kb_list in outline mode (non-null baseId)', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.createAssistant('KB_Outline_Assistant', E2E_ASSISTANT_MODEL_ID, TARGET_BASE)
    await chat.addAssistantToSidebar('KB_Outline_Assistant')

    await chat.ask(
      `请调用 kb_list 工具查看 '${TARGET_BASE}' 知识库内部的文档目录结构：先不传 baseId 列出我的知识库找到它的 id，` +
        `再传入这个 baseId 查看它的目录/文档大纲（outline 模式）。`
    )

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
    await chat.expandToolHistory()
    await expect
      .poll(
        async () => {
          const calls = await chat.toolArgsFor('kb_list')
          return calls.some((call) => call.baseId !== null && call.baseId !== undefined)
        },
        { timeout: 60_000 }
      )
      .toBe(true)
  })
})
