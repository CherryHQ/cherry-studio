import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage, E2E_AGENT_MODEL_ID } from '../../pages/chat-agent.page'
import { fixturePath } from '../../utils/e2e-env'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-f2, full · live: llm + embedding): a KB-equipped agent actually calls the kb_search
 * tool specifically — not just *a* tool (the agent also has kb_list/kb_read/kb_manage available).
 * `toolNamed('kb_search')` reads the wire tool name from `data-tool-name`; the agent runtime's
 * `mcp__cherry-tools__kb_search` gets normalized back to `kb_search` before it reaches the
 * renderer (see `parseFunctionCallToolName`/`buildMcpToolDescriptor`), same as web_search in
 * ws-f2. Agents get the generic `kb_*` tool surface regardless of any per-agent KB linking, so
 * (unlike kb-f1's assistant) creation doesn't need to attach a knowledge base.
 */
test.describe('Knowledge · agent retrieves KB (agentic)', { tag: '@full' }, () => {
  test('agent calls a knowledge tool', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.createAgent('KB_Test_Agent', E2E_AGENT_MODEL_ID)
    await chat.addAgentToSidebar('KB_Test_Agent')

    await chat.ask(`在我的知识库里查一下 ${fixturePath('recall-query')} 相关内容并引用。`)

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
    await chat.expandToolHistory()
    await expect(chat.toolNamed('kb_search').first()).toBeVisible()
  })
})
