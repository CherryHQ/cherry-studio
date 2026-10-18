import { describe, expect, it } from 'vitest'

import { parseLaunchReceiptText } from '../launchReceipt'

describe('launch receipt text', () => {
  it('reads the id the current SDK prints after its parenthetical metadata', () => {
    const receipt =
      "Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: agent-a1b2c3d4e5f6 (internal ID - do not mention to user. Use SendMessage with to: 'agent-a1b2c3d4e5f6', summary: '<5-10 word recap>' to continue this agent.)"

    expect(parseLaunchReceiptText(receipt)).toBe('agent-a1b2c3d4e5f6')
  })

  it('reads the older trailer forms', () => {
    expect(
      parseLaunchReceiptText(
        'Async agent launched successfully.\nagentId: agent-77 (internal metadata - do not mention to user.)'
      )
    ).toBe('agent-77')
    expect(parseLaunchReceiptText('Async agent launched successfully. Internal id: abc-123 (do not mention.)')).toBe(
      'abc-123'
    )
    expect(
      parseLaunchReceiptText("done. agentId: agent-77 (internal metadata. Use SendMessage with to: 'agent-77')")
    ).toBe('agent-77')
  })

  it('reads the dsh launch acknowledgement whole', () => {
    expect(parseLaunchReceiptText('started subagent dsh-child-1')).toBe('dsh-child-1')
  })

  it('does not bind an id from prose that quotes a receipt', () => {
    expect(
      parseLaunchReceiptText(
        'The agent replied: Async agent launched successfully. Then it wrote agentId: fake-123 in prose.'
      )
    ).toBeUndefined()
    expect(parseLaunchReceiptText("To continue, use SendMessage with to: 'agent-77'.")).toBeUndefined()
    expect(parseLaunchReceiptText('started subagent dsh-child-1 and then more prose')).toBeUndefined()
    // The trailer must stay within the prefix's own breath, not somewhere later in the text.
    expect(
      parseLaunchReceiptText(`Async agent launched successfully. ${'x'.repeat(300)} agentId: far-1`)
    ).toBeUndefined()
  })
})
