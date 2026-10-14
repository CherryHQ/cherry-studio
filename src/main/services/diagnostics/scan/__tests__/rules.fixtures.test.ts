import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { diagnose } from '../engine'
import { parseErrorLogLine } from '../logFileSource'
import { SCAN_RULES } from '../rules/registry'

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const FIXTURE_NAME = /^(?<ruleId>[a-z0-9-]+)\.(?<polarity>positive|negative)\.jsonl$/

interface Fixture {
  readonly ruleId: string
  readonly polarity: 'positive' | 'negative'
  readonly domain: string
  readonly lines: string[]
}

function loadFixtures(): Fixture[] {
  const fixtures: Fixture[] = []
  for (const domain of readdirSync(FIXTURES_DIR)) {
    for (const fileName of readdirSync(path.join(FIXTURES_DIR, domain))) {
      const match = FIXTURE_NAME.exec(fileName)
      if (!match?.groups) throw new Error(`Unrecognized fixture file name: ${domain}/${fileName}`)
      const lines = readFileSync(path.join(FIXTURES_DIR, domain, fileName), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
      fixtures.push({
        ruleId: match.groups.ruleId,
        polarity: match.groups.polarity as Fixture['polarity'],
        domain,
        lines
      })
    }
  }
  return fixtures
}

const fixtures = loadFixtures()

describe('scan rule fixtures', () => {
  it('provides a positive and a negative fixture for every registered rule', () => {
    for (const rule of SCAN_RULES) {
      for (const polarity of ['positive', 'negative'] as const) {
        const fixture = fixtures.find((entry) => entry.ruleId === rule.id && entry.polarity === polarity)
        expect(fixture, `missing ${polarity} fixture for ${rule.id}`).toBeDefined()
        expect(fixture!.lines.length, `${polarity} fixture for ${rule.id} is empty`).toBeGreaterThan(0)
        expect(fixture!.domain, `fixture for ${rule.id} lives in the wrong domain directory`).toBe(rule.domain)
      }
    }
  })

  it('has no fixtures for rules that no longer exist', () => {
    const knownIds = new Set(SCAN_RULES.map((rule) => rule.id))
    for (const fixture of fixtures) {
      expect(knownIds.has(fixture.ruleId), `orphan fixture: ${fixture.domain}/${fixture.ruleId}`).toBe(true)
    }
  })

  for (const fixture of fixtures) {
    const rule = SCAN_RULES.find((entry) => entry.id === fixture.ruleId)
    if (!rule) continue

    it(`${fixture.polarity === 'positive' ? 'matches' : 'rejects'} ${fixture.ruleId} ${fixture.polarity} lines`, () => {
      for (const line of fixture.lines) {
        // same parse path as production log scanning
        const parsed = parseErrorLogLine(line)
        expect(parsed, `fixture line failed to parse: ${line.slice(0, 80)}`).toBeDefined()
        const findings = diagnose([parsed!], { rules: [rule] })
        if (fixture.polarity === 'positive') {
          expect(findings, `expected ${rule.id} to match: ${line.slice(0, 120)}`).toHaveLength(1)
          expect(findings[0].ruleId).toBe(rule.id)
        } else {
          expect(findings, `expected ${rule.id} NOT to match: ${line.slice(0, 120)}`).toHaveLength(0)
        }
      }
    })
  }
})
