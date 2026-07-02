import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage, E2E_ASSISTANT_MODEL_ID } from '../../pages/chat-agent.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-f3, full · live: llm + websearch): a web-search-enabled assistant actually calls the
 * web_fetch tool (not web_search — `toolNamed('web_fetch')` reads the wire tool name from
 * `data-tool-name`). Handing the model a URL directly (rather than a topic) is what steers it to
 * `web_fetch` over `web_search` per `WEB_FETCH_DESCRIPTION` ("don't use this when you only have a
 * topic; call web_search first"). The URL goes through r.jina.ai (a URL-to-markdown reader) so the
 * fetch returns clean readable text instead of arXiv's JS-rendered abstract page. Never asserts
 * fetched content/summary quality.
 */
test.describe('WebSearch · assistant fetches a known URL (agentic)', { tag: '@full' }, () => {
  test('assistant calls the web fetch tool', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.createAssistant('WS_Test_Assistant', E2E_ASSISTANT_MODEL_ID)
    await chat.addAssistantToSidebar('WS_Test_Assistant')
    await chat.enableWebSearch()

    await chat.ask('直接抓取这个网页的内容并总结要点，不要搜索：https://r.jina.ai/https://arxiv.org/abs/1706.03762')

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
    await chat.expandToolHistory()
    await expect(chat.toolNamed('web_fetch').first()).toBeVisible()
  })
})
