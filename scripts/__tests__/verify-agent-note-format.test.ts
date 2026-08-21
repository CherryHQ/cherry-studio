import { describe, expect, it } from 'vitest'

import { checkAgentNote } from '../verify-agent-note-format'

const proposed = `# Agent Note: A decision

Status: proposed

English | [中文](2026-08-20-decision.zh.md)

## Problem

Problem.

## Proposal

Proposal.

## Alternatives considered

Alternative.

## Acceptance criteria

- AC1 — A user observes the promised result.
- AC2 — The failure case is rejected.

## Risks

Risk.
`

describe('checkAgentNote', () => {
  it('accepts a proposed note with observable AC IDs', () => {
    expect(
      checkAgentNote(
        '.agents/notes/proposed/feature/2026-08-20-decision.md',
        proposed
          .replace(
            'A user observes the promised result.',
            'A user observes the promised result. (verification: renderer)'
          )
          .replace('The failure case is rejected.', 'The failure case is rejected. (verification: unit)')
      )
    ).toEqual([])
  })

  it('rejects implementation tasks in place of AC IDs', () => {
    expect(
      checkAgentNote(
        '.agents/notes/proposed/feature/2026-08-20-decision.md',
        proposed.replace(
          '- AC1 — A user observes the promised result.\n- AC2 — The failure case is rejected.',
          '- Add a file.'
        )
      )
    ).toContain('Acceptance criteria must contain `- AC1 — <observable outcome>` entries')
  })

  it('requires rejection rationale for a rejected proposal', () => {
    const rejected = proposed
      .replace('Status: proposed', 'Status: rejected — no legitimate consumer')
      .replace(
        '## Acceptance criteria\n\n- AC1 — A user observes the promised result.\n- AC2 — The failure case is rejected.\n\n## Risks\n\nRisk.\n',
        ''
      )
    expect(checkAgentNote('.agents/notes/rejected/feature/2026-08-20-decision.md', rejected)).toContain(
      'missing required section ## Rejection rationale'
    )
  })
})
