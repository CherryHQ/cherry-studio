import { describe, expect, it } from 'vitest'

import { PROMOTION_STEP_ORDER } from '../restoreJournal'
import {
  decideRecoveryAction,
  phaseForStep,
  type RecoveryAction,
  type RecoveryFacts,
  type RecoveryPhase
} from '../restoreRecovery'

describe('phaseForStep', () => {
  it('derives pre-commit for every step before the DB commit and committed at/after it', () => {
    const commitIndex = PROMOTION_STEP_ORDER.indexOf('db-promoted')
    PROMOTION_STEP_ORDER.forEach((step, index) => {
      const expected: RecoveryPhase = index >= commitIndex ? 'committed' : 'pre-commit'
      expect(phaseForStep(step)).toBe(expected)
    })
  })

  it('treats the commit step and the final integrity step as committed', () => {
    expect(phaseForStep('db-promoted')).toBe('committed')
    expect(phaseForStep('integrity-ok')).toBe('committed')
    expect(phaseForStep('live-aside')).toBe('pre-commit')
    expect(phaseForStep('gate-passed')).toBe('pre-commit')
  })
})

// Expected mapping covers the defensive completions of the 16-state total.
const EXPECTED: Record<RecoveryPhase, Record<string, RecoveryAction>> = {
  'pre-commit': {
    '---': 'noop',
    '--A': 'restore-aside',
    '-L-': 'uninstall',
    '-LA': 'restore-aside',
    'S--': 'discard-staged',
    'S-A': 'restore-aside',
    'SL-': 'discard-staged',
    SLA: 'abort-inconsistent'
  },
  committed: {
    '---': 'abort-inconsistent',
    '--A': 'abort-inconsistent',
    '-L-': 'complete',
    '-LA': 'complete',
    'S--': 'install-forward',
    'S-A': 'install-forward',
    'SL-': 'abort-inconsistent',
    SLA: 'abort-inconsistent'
  }
}

function factsFrom(phase: RecoveryPhase, staged: boolean, live: boolean, aside: boolean): RecoveryFacts {
  return { phase, staged, live, aside }
}

function code(staged: boolean, live: boolean, aside: boolean): string {
  return `${staged ? 'S' : '-'}${live ? 'L' : '-'}${aside ? 'A' : '-'}`
}

describe('decideRecoveryAction — totality', () => {
  const phases: RecoveryPhase[] = ['pre-commit', 'committed']
  const bools = [false, true]

  it('maps all 16 (phase × staged × live × aside) states without throwing', () => {
    for (const phase of phases) {
      for (const staged of bools) {
        for (const live of bools) {
          for (const aside of bools) {
            const facts = factsFrom(phase, staged, live, aside)
            const action = decideRecoveryAction(facts)
            expect(action).toBe(EXPECTED[phase][code(staged, live, aside)])
          }
        }
      }
    }
  })
})

describe('decideRecoveryAction — named §6.4 reachable rows', () => {
  it('pre-commit always rolls back', () => {
    expect(decideRecoveryAction(factsFrom('pre-commit', false, true, false))).toBe('uninstall') // row 5
    expect(decideRecoveryAction(factsFrom('pre-commit', false, true, true))).toBe('restore-aside') // row 4
    expect(decideRecoveryAction(factsFrom('pre-commit', true, false, false))).toBe('discard-staged') // row 1
    expect(decideRecoveryAction(factsFrom('pre-commit', true, false, true))).toBe('restore-aside') // row 3 (ambiguous)
    expect(decideRecoveryAction(factsFrom('pre-commit', true, true, false))).toBe('discard-staged') // row 2
  })

  it('committed finishes forward', () => {
    expect(decideRecoveryAction(factsFrom('committed', true, false, true))).toBe('install-forward') // row 6 (ambiguous)
    expect(decideRecoveryAction(factsFrom('committed', false, true, true))).toBe('complete') // row 7
    expect(decideRecoveryAction(factsFrom('committed', false, true, false))).toBe('complete') // row 8
  })
})

describe('decideRecoveryAction — ambiguous (present, absent, present) in both directions', () => {
  it('rolls back under pre-commit and installs forward under committed', () => {
    const preCommit = factsFrom('pre-commit', true, false, true)
    const committed = factsFrom('committed', true, false, true)
    expect(decideRecoveryAction(preCommit)).toBe('restore-aside')
    expect(decideRecoveryAction(committed)).toBe('install-forward')
    // Existence alone (S,-,A) does not determine the action — direction does.
    expect(decideRecoveryAction(preCommit)).not.toBe(decideRecoveryAction(committed))
  })
})

describe('decideRecoveryAction — committed-yet-live-absent fails closed', () => {
  it('aborts rather than fabricating an empty-live promotion', () => {
    expect(decideRecoveryAction(factsFrom('committed', false, false, false))).toBe('abort-inconsistent')
    expect(decideRecoveryAction(factsFrom('committed', false, false, true))).toBe('abort-inconsistent')
  })
})

describe('decideRecoveryAction — both-source-and-live states fail closed', () => {
  it('aborts on unprovable staged+live states instead of overwriting/discarding live', () => {
    // staged AND live both present, where live cannot be proven backup-vs-target-only.
    expect(decideRecoveryAction(factsFrom('pre-commit', true, true, true))).toBe('abort-inconsistent')
    expect(decideRecoveryAction(factsFrom('committed', true, true, false))).toBe('abort-inconsistent')
    expect(decideRecoveryAction(factsFrom('committed', true, true, true))).toBe('abort-inconsistent')
  })

  it('keeps the one provable staged+live state safe: pre-commit with no aside means live is the original target', () => {
    // No aside ⇒ no parking happened ⇒ live is the untouched original → drop staged only.
    expect(decideRecoveryAction(factsFrom('pre-commit', true, true, false))).toBe('discard-staged')
  })
})
