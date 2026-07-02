import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage, E2E_ASSISTANT_MODEL_ID } from '../../pages/chat-agent.page'
import { fixturePath } from '../../utils/e2e-env'
import { waitForAppReady } from '../../utils/wait-helpers'

const TARGET_BASE = 'E2E_Test_KB'

/**
 * Spec (full · live: llm + embedding): a KB-equipped assistant uses `kb_read`'s grep mode —
 * passing `pattern` to search one document for an exact match, as opposed to its read mode
 * (omitted `pattern`, which returns the document text/slice). `kb_read` is unconditionally
 * deferred (`defer: 'always'`, see `shouldDefer.ts`), so it's only reachable via `tool_invoke`;
 * its own name never appears in `data-tool-name` (that's always `tool_invoke`) — the target and
 * mode only show up in `tool_invoke`'s own `{ name, params }` arguments (`data-tool-args`, see
 * `toolArgsFor`). We assert only that a `kb_read` grep-mode call fired, never on the match
 * content/line numbers.
 */
test.describe('Knowledge · assistant greps a document via kb_read (agentic)', { tag: '@full' }, () => {
  test('assistant calls kb_read in grep mode (pattern set)', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.createAssistant('KB_Grep_Assistant', E2E_ASSISTANT_MODEL_ID, TARGET_BASE)
    await chat.addAssistantToSidebar('KB_Grep_Assistant')

    await chat.ask(
      `请在我的 '${TARGET_BASE}' 知识库文档里，用 kb_read 的 grep 模式（传入 pattern 参数做精确查找，不要用整篇` +
        `读取模式）查找包含 "${fixturePath('recall-query')}" 这句话的位置，告诉我它在第几行。`
    )

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
    await chat.expandToolHistory()
    await expect
      .poll(
        async () => {
          const invokes = await chat.toolArgsFor('tool_invoke')
          return invokes.some((call) => {
            if (call.name !== 'kb_read') return false
            const params = call.params as Record<string, unknown> | undefined
            return typeof params?.pattern === 'string' && params.pattern.length > 0
          })
        },
        { timeout: 90_000 }
      )
      .toBe(true)
  })
})
