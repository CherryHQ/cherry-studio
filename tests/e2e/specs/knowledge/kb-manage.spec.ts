import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage, E2E_ASSISTANT_MODEL_ID } from '../../pages/chat-agent.page'
import { KnowledgePage } from '../../pages/knowledge.page'
import { waitForAppReady } from '../../utils/wait-helpers'

const TARGET_BASE = 'E2E_Test_KB'
const NOTE_CONTENT = 'e2e kb_manage regression probe'

/**
 * Spec (kb-f3, full · live: llm): a KB-equipped assistant adds a new source via `kb_manage`
 * (action="add", type="note").
 *
 * `kb_manage` used to be unreachable from the assistant chat path — `defer: 'always'` +
 * `needsApproval: true` deadlocked (`tool_invoke` refuses to run an approval-gated tool, but a
 * deferred entry is never in the inline `ToolSet` for the SDK's own approval gate to catch either).
 * Fixed by keeping it inline (`defer: 'never'`, same rule `mcp/mcpTools.ts` applies to force-prompt
 * MCP tools) so the SDK's native approval gate fires — see `KnowledgeManageTool.ts`. This spec
 * drives that real approval round-trip: send → wait for the permission request → approve it →
 * confirm the note actually landed in the base. MCP-backed Agents use a separate permission
 * system, unaffected either way — see `agent-kb.spec.ts`.
 *
 * Unlike `kb_list`/`kb_read`/`kb_search`, an approved `kb_manage` call renders no `data-tool-name`
 * card in the message thread (verified live: `kb_list`'s discovery call gets one, the subsequent
 * `kb_manage` call does not, even though it demonstrably executes — the model's own confirmation
 * text is the only in-thread trace). So the envelope-based assertion `assistant-kb.spec.ts` etc.
 * use doesn't apply here; we verify the actual mutation via the knowledge base's own data-source
 * list instead — a stronger signal anyway, since it proves the write really happened.
 */
test.describe('Knowledge · assistant adds a source via kb_manage (agentic)', { tag: '@full' }, () => {
  test('assistant calls kb_manage to add a note', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.createAssistant('KB_Manage_Assistant', E2E_ASSISTANT_MODEL_ID, TARGET_BASE)
    await chat.addAssistantToSidebar('KB_Manage_Assistant')

    await chat.ask(
      `请调用知识库管理工具（kb_manage），把这段文字作为一条 note 添加到 '${TARGET_BASE}' 知识库里：` +
        `"${NOTE_CONTENT}"。`
    )

    // The approval request appearing (and being satisfiable at all) is itself proof the deadlock
    // is fixed — a deferred tool never reaches the SDK's native approval gate in the first place.
    await chat.approveToolPermission()

    const kb = new KnowledgePage(mainWindow)
    await kb.openBase(TARGET_BASE)
    await expect(kb.itemRows.filter({ hasText: NOTE_CONTENT })).toBeVisible({ timeout: 90_000 })
  })
})
