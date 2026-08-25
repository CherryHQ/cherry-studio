/**
 * Per-runtime reclamation of orphaned session state, driven by the resume-token
 * keep-set the agent orphan sweep reads from the database.
 *
 * Each layout below is taken from the runtime that owns it, not guessed:
 *  - pi    — `resolveResumeTokenSessionFile` resolves `{ts}_{token}.jsonl`
 *  - dsh   — `@deepseek-ai/dsh-session-persistence-jsonl` writes
 *            `{projectKey(cwd)}/{sessionId}/session.jsonl`
 *  - claude — the Agent SDK's `deleteSession` removes `{id}.jsonl` plus the
 *            `{id}/` subagent-transcript directory from the projects dir
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { DshRuntimeDriver } from '../dsh/DshRuntimeDriver'
import { PiRuntimeDriver } from '../pi/PiRuntimeDriver'
import { registerRuntimeDrivers } from '../registerDrivers'
import { runtimeDriverRegistry } from '../registry'

const NOW = 1_800_000_000_000
const FRESHNESS_GATE_MS = 5 * 60 * 1000
const OPTIONS = { freshnessGateMs: FRESHNESS_GATE_MS, now: NOW }
/** Older than the freshness gate, so the sweep is allowed to act. */
const STALE_SECONDS = (NOW - 60 * 60 * 1000) / 1000

let root: string

function seedFile(relativePath: string, mtimeSeconds = STALE_SECONDS): string {
  const target = path.join(root, relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, 'x')
  utimesSync(target, mtimeSeconds, mtimeSeconds)
  return target
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cs-runtime-reclaim-'))
  ;(application.getPath as Mock).mockImplementation((key: string) => path.join(root, key))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.mocked(application.getPath as Mock).mockReset()
})

describe('PiRuntimeDriver.reclaimOrphanSessions', () => {
  const driver = new PiRuntimeDriver()
  const sessions = 'feature.agents.pi.sessions'

  it('removes unclaimed sessions and keeps every generation of a claimed one', async () => {
    const orphan = seedFile(`${sessions}/2026-08-19T00-00-00-000Z_gone.jsonl`)
    const claimedOld = seedFile(`${sessions}/2026-08-18T00-00-00-000Z_live.jsonl`)
    const claimedNew = seedFile(`${sessions}/2026-08-19T00-00-00-000Z_live.jsonl`)

    const { removed } = await driver.reclaimOrphanSessions(new Set(['live']), OPTIONS)

    expect(removed).toEqual([orphan])
    expect(existsSync(claimedOld)).toBe(true)
    expect(existsSync(claimedNew)).toBe(true)
  })

  it('keeps a claimed session whose resume token contains an underscore', async () => {
    // `_` is legal in a pi resume token, so splitting the stem on the LAST one
    // truncated the token and made a live session look orphaned.
    const claimed = seedFile(`${sessions}/2026-08-19T00-00-00-000Z_tok_with_underscore.jsonl`)

    const { removed } = await driver.reclaimOrphanSessions(new Set(['tok_with_underscore']), OPTIONS)

    expect(removed).toEqual([])
    expect(existsSync(claimed)).toBe(true)
  })

  it('ignores names it cannot parse into a resume token', async () => {
    const notPi = seedFile(`${sessions}/index.json`)
    const noToken = seedFile(`${sessions}/nounderscore.jsonl`)

    const { removed } = await driver.reclaimOrphanSessions(new Set(), OPTIONS)

    expect(removed).toEqual([])
    expect(existsSync(notPi)).toBe(true)
    expect(existsSync(noToken)).toBe(true)
  })

  it('defers a session still being written', async () => {
    const warm = seedFile(`${sessions}/2026-08-19T00-00-00-000Z_warm.jsonl`, (NOW - 60_000) / 1000)

    const { removed } = await driver.reclaimOrphanSessions(new Set(), OPTIONS)

    expect(removed).toEqual([])
    expect(existsSync(warm)).toBe(true)
  })

  it('no-ops when the runtime was never used', async () => {
    await expect(driver.reclaimOrphanSessions(new Set(), OPTIONS)).resolves.toEqual({ removed: [] })
  })
})

describe('DshRuntimeDriver.reclaimOrphanSessions', () => {
  const driver = new DshRuntimeDriver()
  const sessions = 'feature.agents.dsh.sessions'

  it('keeps a project whose parent session is claimed, including its subagent dirs', async () => {
    // A subagent runs under an id Cherry never records but shares the parent's cwd.
    seedFile(`${sessions}/--tmp-live--/parent-token/session.jsonl`)
    seedFile(`${sessions}/--tmp-live--/subagent-9f2/session.jsonl`)

    const { removed } = await driver.reclaimOrphanSessions(new Set(['parent-token']), OPTIONS)

    expect(removed).toEqual([])
    expect(existsSync(path.join(root, sessions, '--tmp-live--', 'subagent-9f2'))).toBe(true)
  })

  it('removes a whole project directory once none of its sessions are claimed', async () => {
    seedFile(`${sessions}/--tmp-dead--/gone-token/session.jsonl`)
    seedFile(`${sessions}/--tmp-dead--/subagent-1a3/session.jsonl`)
    const live = seedFile(`${sessions}/--tmp-live--/live-token/session.jsonl`)

    const { removed } = await driver.reclaimOrphanSessions(new Set(['live-token']), OPTIONS)

    expect(removed).toEqual([path.join(root, sessions, '--tmp-dead--')])
    expect(existsSync(path.join(root, sessions, '--tmp-dead--'))).toBe(false)
    expect(existsSync(live)).toBe(true)
  })

  it('defers a project whose session log is still being written', async () => {
    seedFile(`${sessions}/--tmp-warm--/warm-token/session.jsonl`, (NOW - 60_000) / 1000)

    const { removed } = await driver.reclaimOrphanSessions(new Set(), OPTIONS)

    expect(removed).toEqual([])
    expect(existsSync(path.join(root, sessions, '--tmp-warm--'))).toBe(true)
  })

  it('no-ops when the runtime was never used', async () => {
    await expect(driver.reclaimOrphanSessions(new Set(), OPTIONS)).resolves.toEqual({ removed: [] })
  })
})

describe('claude-code reclaimOrphanSessions', () => {
  const projects = 'feature.agents.claude.projects'

  function claudeDriver() {
    runtimeDriverRegistry.clearForTest()
    registerRuntimeDrivers()
    const driver = runtimeDriverRegistry.getAgentSessionDriver('claude-code')
    if (!driver?.reclaimOrphanSessions) throw new Error('claude-code driver missing reclaimOrphanSessions')
    return driver
  }

  afterEach(() => runtimeDriverRegistry.clearForTest())

  it('removes an unclaimed transcript with its subagent directory, keeping claimed ones', async () => {
    const orphan = seedFile(`${projects}/-tmp-work/gone-id.jsonl`)
    const orphanSubagents = seedFile(`${projects}/-tmp-work/gone-id/agent-1.jsonl`)
    const claimed = seedFile(`${projects}/-tmp-work/live-id.jsonl`)

    const { removed } = await claudeDriver().reclaimOrphanSessions!(new Set(['live-id']), OPTIONS)

    expect(removed).toEqual([orphan, path.join(root, projects, '-tmp-work', 'gone-id')])
    expect(existsSync(orphanSubagents)).toBe(false)
    expect(existsSync(claimed)).toBe(true)
  })

  it("never leaves Cherry's own projects dir", async () => {
    // The Claude-login provider writes into the user's real ~/.claude by design
    // (settingsBuilder deletes CLAUDE_CONFIG_DIR for it), so that corpus is shared
    // with the user's terminal sessions and must stay untouched.
    const userHome = seedFile('sys.home/.claude/projects/-tmp-work/personal-id.jsonl')
    seedFile(`${projects}/-tmp-work/gone-id.jsonl`)

    await claudeDriver().reclaimOrphanSessions!(new Set(), OPTIONS)

    expect(existsSync(userHome)).toBe(true)
  })

  it('no-ops when the runtime was never used', async () => {
    await expect(claudeDriver().reclaimOrphanSessions!(new Set(), OPTIONS)).resolves.toEqual({ removed: [] })
  })
})
