// Conformance corpus: derived from the CommonMark 0.31.2 specification
// examples (https://spec.commonmark.org/0.31.2/, CC BY-SA 4.0, (c) the
// CommonMark authors). Regenerate with ./generate-corpus-cases.sh (same dir).
import { describe, expect, it } from 'vitest'

import { stripKnownModelScratchpadBlocksPreservingCodeFences, stripModelScratchpadBlocks } from '../scratchpadText'
import cases from './corpus-cases.json'

// CommonMark conformance sweep: probe tags injected into spec-derived shapes
// must survive where the shape makes them visible content ('preserve') and be
// stripped where they parse as top-level scratchpad ('strip'). Known-failing
// cases document inherited-class gaps; they are leads, not accepted losses.
// Known-failing conformance leads (inherited-class gaps, present on the
// published head before round 17; tracked as leads per cherry-pr-review
// round-17 triage, not accepted losses):
// - ex138C/ex145C/ex121S: fence-adjacent shapes where the whole-text
//   classification diverges from CommonMark.
// - ex170S-ex173S/ex178S: HTML-block shapes where an injected probe inside
//   visible table/pre content is stripped.
// it.fails keeps each lead gated: a future fix turns the case green, which
// fails it.fails and forces the lead list to shrink.
// ex313C retired: the round-17 stale-sibling-ownership fix (sibling list
// markers pop every level above the marker column) classifies the indented
// line as top-level code again (cherry-pr-review P2, CommonMark ex313).
const KNOWN_FAILS = new Set(['ex138C', 'ex145C', 'ex121S', 'ex170S', 'ex171S', 'ex172S', 'ex173S', 'ex178S'])

describe('commonmark conformance sweep (head)', () => {
  for (const c of cases) {
    const run = KNOWN_FAILS.has(c.id) ? it.fails : it
    run(`${c.id} [${c.section}] expect ${c.expect}`, () => {
      const probe = `PROBE_${c.id}`
      const out = stripModelScratchpadBlocks(c.input)
      const pres = stripKnownModelScratchpadBlocksPreservingCodeFences(c.input)
      if (c.expect === 'preserve') {
        expect(out).toContain(probe)
        expect(pres).toContain(probe)
      } else {
        expect(out).not.toContain(probe)
        expect(pres).not.toContain(probe)
      }
    })
  }
})
