import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage, E2E_AGENT_MODEL_ID } from '../../pages/chat-agent.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-f2, full · live: llm + websearch): a web-search agent actually calls the web_search
 * tool — not just *a* tool. The agent runtime calls it over MCP as `mcp__cherry-tools__web_search`,
 * but the renderer normalizes that back to the short wire name `web_search` (see
 * `parseFunctionCallToolName`/`buildMcpToolDescriptor`), so `toolNamed('web_search')` (reading
 * `data-tool-name`) works identically for the assistant (ws-f1) and agent flow here. Pick the
 * agent from the bottom picker, type into the draft, send (no global "new session").
 */
test.describe('WebSearch · agent searches the web (agentic)', { tag: '@full' }, () => {
  test('agent calls the web search tool', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.createAgent('WS_Test_Agent', E2E_AGENT_MODEL_ID)
    await chat.addAgentToSidebar('WS_Test_Agent')

    await chat.ask('用网络搜索查一下 2026 年 6 月 OpenAI 有哪些新发布，并给出来源链接。')

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
    await chat.expandToolHistory()
    await expect(chat.toolNamed('web_search').first()).toBeVisible()
  })
})
