import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@renderer/hooks/useToolResult', () => ({
  useToolResult: vi.fn(() => ({ output: undefined, error: undefined, isLoading: true }))
}))
vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListTopicId: () => 'topic-1',
  useOptionalMessageListActions: () => undefined
}))

import type { CherryMessagePart } from '@shared/data/types/message'

import { MessagePartsScopeProvider } from '../../blocks/MessagePartsContext'
import MessageTools from '../MessageTools'
import { buildToolResponseFromPart } from '../toolResponse'

// Issue #20265 regression: the dsh bash tool's JSON-looking output used to be JSON.parse'd
// before persistence, so stored parts carry corrupted shapes (an object `output`, or an
// `output-error` part with no `output` key) and a corrupt non-string `input.command`. The
// full dispatch chain (part → toolResponse → MessageTools → BashTool → TerminalOutput) must
// render every stored shape without throwing, or the whole chat page white-screens.
const DSH_TRANSPORT = 'dsh-agent'

function bashPart(overrides: Record<string, unknown>): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolName: 'bash',
    toolCallId: 'bash-1',
    input: { command: 'echo hi' },
    callProviderMetadata: { cherry: { transport: DSH_TRANSPORT, tool: { type: 'builtin', name: 'bash' } } },
    ...overrides
  } as unknown as CherryMessagePart
}

async function renderPartExpectingText(part: CherryMessagePart, expectedText: string): Promise<void> {
  const toolResponse = buildToolResponseFromPart(part)
  expect(toolResponse).not.toBeNull()
  const { container } = render(
    <MessagePartsScopeProvider messageId="m1" parts={[part]}>
      <MessageTools toolResponse={toolResponse!} />
    </MessagePartsScopeProvider>
  )
  // The lazy agent-timeline chunk loads async; textContent also survives the collapsed
  // disclosure and ANSI-colorized spans, so assert against the raw container text.
  await waitFor(() => expect(container.textContent).toContain(expectedText))
}

describe('bash tool corrupted-output dispatch regression (#20265)', () => {
  it('renders a JSON.parse-d output object part without throwing', async () => {
    await renderPartExpectingText(
      bashPart({
        state: 'output-available',
        output: { content: [{ type: 'text', text: 'persisted bash stdout' }] }
      }),
      'persisted bash stdout'
    )
  })

  it('renders an output-error part carrying only errorText without throwing', async () => {
    await renderPartExpectingText(
      bashPart({ state: 'output-error', errorText: 'command failed with exit 1' }),
      'command failed with exit 1'
    )
  })

  it('renders a non-string input.command without throwing', async () => {
    await renderPartExpectingText(
      bashPart({
        state: 'output-available',
        input: { command: { script: 'echo hi' } },
        output: 'plain stdout'
      }),
      'plain stdout'
    )
  })
})
