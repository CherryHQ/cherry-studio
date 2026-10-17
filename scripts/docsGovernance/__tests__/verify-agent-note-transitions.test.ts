import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkAgentNoteTransition, collectAgentNoteTransitionReport } from '../verify-agent-note-transitions'

const proposed = `# Agent Note: Decision

Status: proposed

English | [中文](2026-10-01-decision.zh.md)

## Problem

Problem.

## Proposal

Proposal.

## Alternatives considered

Alternative.

## Acceptance criteria

- AC1 — First outcome. (verification: unit)
- AC2 — Second outcome. (verification: docs gate)

## Risks

Risk.
`

const implemented = `# Agent Note: Decision

Status: implemented

English | [中文](2026-10-01-decision.zh.md)

## Problem

Problem.

## Decision

Decision.

## Alternatives considered

Alternative.

## Consequences

Consequence.

## Verification

- AC1 — \`pnpm test:scripts\`: catches the first regression.
- AC2 — \`pnpm docs:check\`: catches documentation drift.
`

const proposedPath = '.agents/notes/proposed/process/2026-10-01-decision.md'
const implementedPath = '.agents/notes/implemented/process/2026-10-01-decision.md'
const tempDirs: string[] = []

const git = (root: string, ...args: string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()

const writeTriplet = (root: string, notePath: string, english: string): void => {
  const stem = notePath.slice(0, -'.md'.length)
  fs.mkdirSync(path.dirname(path.join(root, notePath)), { recursive: true })
  fs.writeFileSync(path.join(root, notePath), english)
  fs.writeFileSync(path.join(root, `${stem}.zh.md`), english)
  fs.writeFileSync(path.join(root, `${stem}.i18n.yaml`), 'pair: recorded\n')
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('Agent Note lifecycle transitions', () => {
  it('accepts a proposed-to-implemented transition with complete AC evidence', () => {
    expect(checkAgentNoteTransition(proposedPath, proposed, implementedPath, implemented)).toMatchObject({ errors: [] })
  })

  it('rejects an implemented note that omits an acceptance criterion', () => {
    const incomplete = implemented.replace('- AC2 — `pnpm docs:check`: catches documentation drift.\n', '')
    expect(checkAgentNoteTransition(proposedPath, proposed, implementedPath, incomplete).errors).toContain(
      'Verification is missing AC2'
    )
  })

  it('rejects duplicate verification evidence for one acceptance criterion', () => {
    const duplicate = implemented.replace(
      '- AC2 — `pnpm docs:check`: catches documentation drift.',
      '- AC1 — `pnpm test:other`: duplicates the first criterion.\n- AC2 — `pnpm docs:check`: catches documentation drift.'
    )
    expect(checkAgentNoteTransition(proposedPath, proposed, implementedPath, duplicate).errors).toContain(
      'Verification repeats criteria: AC1'
    )
  })

  it('rejects lifecycle rewrites after a decision has shipped', () => {
    const rejectedPath = '.agents/notes/rejected/process/2026-10-01-decision.md'
    const rejected = proposed.replace('Status: proposed', 'Status: rejected — superseded')
    expect(checkAgentNoteTransition(implementedPath, implemented, rejectedPath, rejected).errors).toContain(
      'unsupported lifecycle transition: implemented → rejected'
    )
  })

  it('rejects a lifecycle move that leaves source pair artifacts behind', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-note-transition-'))
    tempDirs.push(root)
    git(root, 'init', '--quiet')
    git(root, 'config', 'user.email', 'notes@example.test')
    git(root, 'config', 'user.name', 'Notes Test')
    git(root, 'config', 'commit.gpgsign', 'false')
    writeTriplet(root, proposedPath, proposed)
    git(root, 'add', '.')
    git(root, 'commit', '--quiet', '-m', 'proposed')
    const base = git(root, 'rev-parse', 'HEAD')

    writeTriplet(root, implementedPath, implemented)
    fs.unlinkSync(path.join(root, proposedPath))
    git(root, 'add', '.')
    git(root, 'commit', '--quiet', '-m', 'incomplete transition')

    expect(collectAgentNoteTransitionReport({ base }, root).errors).toEqual(
      expect.arrayContaining([
        `${proposedPath}: head still contains ${proposedPath.replace(/\.md$/u, '.zh.md')}`,
        `${proposedPath}: head still contains ${proposedPath.replace(/\.md$/u, '.i18n.yaml')}`
      ])
    )
  })
})
