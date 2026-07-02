import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage, E2E_ASSISTANT_MODEL_ID } from '../../pages/chat-agent.page'
import { fixturePath } from '../../utils/e2e-env'
import { waitForAppReady } from '../../utils/wait-helpers'

const TARGET_BASE = 'E2E_Test_KB'

/**
 * Spec (kb-f1, full · live: llm + embedding): a KB-equipped assistant actually retrieves from its
 * knowledge base. The classic AI-SDK path defers `kb_search`/`kb_read`/`kb_manage` behind
 * `tool_search`/`tool_invoke` unconditionally (see `shouldDefer.ts`) — only `kb_list` stays
 * inline. So a deferred call never shows its own name in `data-tool-name` (it's always
 * `tool_invoke`); the target only appears in `tool_invoke`'s own `{ name, params }` arguments
 * (`data-tool-args`, see `toolArgsFor`). We accept `kb_list` firing directly OR `tool_invoke`
 * dispatching to `kb_search`/`kb_read` as evidence retrieval happened; we never assert
 * ranking/scores/content. Envelope-missing = the tool truly never fired.
 */
test.describe('Knowledge · assistant retrieves KB (agentic)', { tag: '@full' }, () => {
  test('assistant calls a knowledge tool', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.createAssistant('KB_Test_Assistant', E2E_ASSISTANT_MODEL_ID, TARGET_BASE)
    await chat.addAssistantToSidebar('KB_Test_Assistant')

    await chat.ask(`在我的知识库里查一下 ${fixturePath('recall-query')} 相关内容并引用。`)

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
    await chat.expandToolHistory()
    await expect
      .poll(
        async () => {
          if ((await chat.toolNamed('kb_list').count()) > 0) return true
          const invokes = await chat.toolArgsFor('tool_invoke')
          return invokes.some((call) => call.name === 'kb_search' || call.name === 'kb_read')
        },
        { timeout: 60_000 }
      )
      .toBe(true)
  })
})
