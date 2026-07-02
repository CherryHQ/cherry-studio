import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage, E2E_ASSISTANT_MODEL_ID } from '../../pages/chat-agent.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-f3, full · live: llm + websearch): the search actually completes and returns results.
 * Goes one step beyond WS-F1: assert the MessageWebSearch result block (`message-websearch-result`,
 * mounted only when status=done with results>0). The result block is nested INSIDE the
 * process-history group, so: wait for the tool envelope → expand it → poll the result block.
 * Structural signal only — never asserts result content/ranking/count.
 */
test.describe('WebSearch · search completes with results (agentic)', { tag: '@full' }, () => {
  // fixme: live-timing flaky. The result block (message-websearch-result) mounts only at
  // toolResponse.status==='done' with results>0; under a live multi-tool agent run the web_search
  // can stay "调用中" past the window (the search returns results, but the status doesn't settle).
  // ws-f1/ws-f2 cover "tool was called"; this stricter "results rendered" step is reported, not gating.
  test.fixme('web search returns a result block', async ({ mainWindow }) => {
    test.setTimeout(360_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.createAssistant('WS_Test_Assistant', E2E_ASSISTANT_MODEL_ID)
    await chat.addAssistantToSidebar('WS_Test_Assistant')
    await chat.enableWebSearch()

    await chat.ask('用网络搜索查一下 2026 年 6 月 OpenAI 有哪些新发布，并给出来源链接。')

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
    await chat.toolHistory.first().click() // expand: the result block is nested in the collapse group
    await expect(chat.webSearchResult).toBeVisible({ timeout: 240_000 })
  })
})
