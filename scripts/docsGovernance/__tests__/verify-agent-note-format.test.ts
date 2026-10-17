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

const implemented = proposed
  .replace('Status: proposed', 'Status: implemented')
  .replace('## Proposal\n\nProposal.', '## Decision\n\nDecision.')
  .replace('## Acceptance criteria', '## Verification')
  .replace('- AC1 — A user observes the promised result.', '- AC1 — `pnpm test`: catches the regression.')
  .replace('- AC2 — The failure case is rejected.', '- AC2 — Electron scenario: observes the result.')
  .replace('## Risks\n\nRisk.', '## Consequences\n\nConsequence.')

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

  it('ignores headings and acceptance criteria inside tilde fences', () => {
    const fenced = `# Agent Note: A decision

Status: proposed

English | [中文](2026-08-20-decision.zh.md)

## Problem

Problem.

~~~md
## Proposal

Proposal.

## Alternatives considered

Alternative.

## Acceptance criteria

- AC1 — Fake outcome. (verification: unit)

## Risks

Risk.
~~~
`

    expect(checkAgentNote('.agents/notes/proposed/feature/2026-08-20-decision.md', fenced)).toEqual(
      expect.arrayContaining([
        'missing required section ## Proposal',
        'missing required section ## Alternatives considered',
        'missing required section ## Acceptance criteria',
        'missing required section ## Risks',
        'Acceptance criteria must contain `- AC1 — <observable outcome>` entries'
      ])
    )
  })

  it('ignores acceptance criteria inside fenced examples', () => {
    const fencedCriterion = proposed.replace(
      '- AC1 — A user observes the promised result.\n- AC2 — The failure case is rejected.',
      '```md\n- AC1 — Fake outcome. (verification: unit)\n```'
    )

    expect(checkAgentNote('.agents/notes/proposed/feature/2026-08-20-decision.md', fencedCriterion)).toContain(
      'Acceptance criteria must contain `- AC1 — <observable outcome>` entries'
    )
  })

  it('ignores verification evidence inside fenced examples', () => {
    const fencedVerification = implemented.replace(
      '- AC1 — `pnpm test`: catches the regression.\n- AC2 — Electron scenario: observes the result.',
      '~~~md\n- AC1 — fake evidence\n~~~'
    )

    expect(checkAgentNote('.agents/notes/implemented/feature/2026-08-20-decision.md', fencedVerification)).toContain(
      'Verification must map AC IDs or a direct bug regression to actual evidence'
    )
  })
})
