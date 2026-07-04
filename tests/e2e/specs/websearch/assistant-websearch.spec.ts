import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage, E2E_ASSISTANT_MODEL_ID } from '../../pages/chat-agent.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-f1, full · live: llm + websearch): a web-search-enabled assistant actually calls the
 * web_search tool (not just *a* tool — `toolNamed('web_search')` reads the wire tool name from
 * `data-tool-name`). Never asserts search content/ranking/quality. First tool call can take ~70s
 * under live LLM.
 */
test.describe('WebSearch · assistant searches the web (agentic)', { tag: '@full' }, () => {
  test('assistant calls the web search tool', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.createAssistant('WS_Test_Assistant', E2E_ASSISTANT_MODEL_ID)
    await chat.addAssistantToSidebar('WS_Test_Assistant')
    await chat.enableWebSearch()

    await chat.ask('用网络搜索查一下 2026 年 6 月 OpenAI 有哪些新发布，并给出来源链接。')

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
    await chat.expandToolHistory()
    await expect(chat.toolNamed('web_search').first()).toBeVisible()
  })
})
