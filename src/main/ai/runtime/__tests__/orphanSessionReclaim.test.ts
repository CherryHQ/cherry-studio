/**
 * Per-runtime reclamation of orphaned session state, driven by the resume-token
 * keep-set the agent orphan sweep reads from the database.
 *
 * Each layout below is taken from the runtime that owns it, not guessed:
 *  - pi    — `resolveResumeTokenSessionFile` resolves `{ts}_{token}.jsonl`
 *  - claude — the Agent SDK's `deleteSession` removes `{id}.jsonl` plus the
 *            `{id}/` subagent-transcript directory from the projects dir
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { application } from '@application'
import { claudeProjectDirectoryName } from '@main/ai/utils/claudeProject'

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

function makeStale(target: string): void {
  if (statSync(target).isDirectory()) {
    for (const child of readdirSync(target)) makeStale(path.join(target, child))
  }
  utimesSync(target, STALE_SECONDS, STALE_SECONDS)
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

    const { removed } = await driver.reclaimOrphanSessions(
      { resumeTokens: new Set(['live']), liveWorkspacePaths: new Set() },
      OPTIONS
    )

    expect(removed).toEqual([orphan])
    expect(existsSync(claimedOld)).toBe(true)
    expect(existsSync(claimedNew)).toBe(true)
  })

  it('keeps a claimed session whose resume token contains an underscore', async () => {
    // `_` is legal in a pi resume token, so splitting the stem on the LAST one
    // truncated the token and made a live session look orphaned.
    const claimed = seedFile(`${sessions}/2026-08-19T00-00-00-000Z_tok_with_underscore.jsonl`)

    const { removed } = await driver.reclaimOrphanSessions(
      { resumeTokens: new Set(['tok_with_underscore']), liveWorkspacePaths: new Set() },
      OPTIONS
    )

    expect(removed).toEqual([])
    expect(existsSync(claimed)).toBe(true)
  })

  it('ignores names it cannot parse into a resume token', async () => {
    const notPi = seedFile(`${sessions}/index.json`)
    const noToken = seedFile(`${sessions}/nounderscore.jsonl`)

    const { removed } = await driver.reclaimOrphanSessions(
      { resumeTokens: new Set(), liveWorkspacePaths: new Set() },
      OPTIONS
    )

    expect(removed).toEqual([])
    expect(existsSync(notPi)).toBe(true)
    expect(existsSync(noToken)).toBe(true)
  })

  it('defers a session still being written', async () => {
    const warm = seedFile(`${sessions}/2026-08-19T00-00-00-000Z_warm.jsonl`, (NOW - 60_000) / 1000)

    const { removed } = await driver.reclaimOrphanSessions(
      { resumeTokens: new Set(), liveWorkspacePaths: new Set() },
      OPTIONS
    )

    expect(removed).toEqual([])
    expect(existsSync(warm)).toBe(true)
  })

  it('no-ops when the runtime was never used', async () => {
    await expect(
      driver.reclaimOrphanSessions({ resumeTokens: new Set(), liveWorkspacePaths: new Set() }, OPTIONS)
    ).resolves.toEqual({ removed: [] })
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
    const orphan = seedFile(`${projects}/-tmp-work/11111111-1111-1111-1111-111111111111.jsonl`)
    const orphanSubagents = seedFile(`${projects}/-tmp-work/11111111-1111-1111-1111-111111111111/agent-1.jsonl`)
    const claimed = seedFile(`${projects}/-tmp-work/22222222-2222-2222-2222-222222222222.jsonl`)

    makeStale(path.join(root, projects))
    const { removed } = await claudeDriver().reclaimOrphanSessions!(
      { resumeTokens: new Set(['22222222-2222-2222-2222-222222222222']), liveWorkspacePaths: new Set() },
      OPTIONS
    )

    expect(removed).toEqual([orphan, path.join(root, projects, '-tmp-work', '11111111-1111-1111-1111-111111111111')])
    expect(existsSync(orphanSubagents)).toBe(false)
    expect(existsSync(claimed)).toBe(true)
  })

  it("never leaves Cherry's own projects dir", async () => {
    // The Claude-login provider writes into the user's real ~/.claude by design
    // (settingsBuilder deletes CLAUDE_CONFIG_DIR for it), so that corpus is shared
    // with the user's terminal sessions and must stay untouched.
    const userHome = seedFile('sys.home/.claude/projects/-tmp-work/33333333-3333-3333-3333-333333333333.jsonl')
    const inside = seedFile(`${projects}/-tmp-work/11111111-1111-1111-1111-111111111111.jsonl`)
    makeStale(path.join(root, projects))

    await claudeDriver().reclaimOrphanSessions!({ resumeTokens: new Set(), liveWorkspacePaths: new Set() }, OPTIONS)

    expect(existsSync(userHome)).toBe(true)
    expect(existsSync(inside)).toBe(false)
  })

  it('protects the entire owned project without a token and reclaims an unowned control', async () => {
    const workspace = path.join(root, 'workspace')
    const ownedProject = claudeProjectDirectoryName(workspace)
    const token = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const owned = seedFile(`${projects}/${ownedProject}/${token}.jsonl`)
    const ownedSubagent = seedFile(`${projects}/${ownedProject}/${token}/subagents/agent-1.jsonl`)
    const orphan = seedFile(`${projects}/unowned/${token}.jsonl`)
    const orphanSubagent = seedFile(`${projects}/unowned/${token}/subagents/agent-1.jsonl`)
    makeStale(path.join(root, projects))

    const { removed } = await claudeDriver().reclaimOrphanSessions!(
      {
        resumeTokens: new Set(),
        liveWorkspacePaths: new Set([workspace])
      },
      OPTIONS
    )

    expect(removed).toEqual([orphan, path.dirname(path.dirname(orphanSubagent))])
    expect(existsSync(owned)).toBe(true)
    expect(existsSync(ownedSubagent)).toBe(true)
    expect(existsSync(orphanSubagent)).toBe(false)
  })

  it('retains ordinary project data while reclaiming UUID pairs and directory-only artifacts', async () => {
    const token = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'
    const directoryOnlyToken = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const retained = ['memory/facts.md', 'session-env/state.json', 'memory.jsonl'].map((name) =>
      seedFile(`${projects}/unowned/${name}`)
    )
    const transcript = seedFile(`${projects}/unowned/${token}.jsonl`)
    const subagent = seedFile(`${projects}/unowned/${token}/subagents/agent-1.jsonl`)
    const directoryOnly = seedFile(`${projects}/unowned/${directoryOnlyToken}/subagents/agent-2.jsonl`)
    makeStale(path.join(root, projects))

    const { removed } = await claudeDriver().reclaimOrphanSessions!(
      {
        resumeTokens: new Set(),
        liveWorkspacePaths: new Set()
      },
      OPTIONS
    )

    expect(new Set(removed)).toEqual(
      new Set([transcript, path.dirname(path.dirname(subagent)), path.dirname(path.dirname(directoryOnly))])
    )
    for (const target of retained) expect(existsSync(target)).toBe(true)
    for (const target of [transcript, subagent, directoryOnly]) expect(existsSync(target)).toBe(false)
  })

  // Windows realpath may use a different short/long spelling than the async resolver, so the fixture key cannot be pinned.
  it.skipIf(process.platform === 'win32').each([false, true])(
    'protects the canonical project under a symlinked parent (archived: %s)',
    async (archived) => {
      const realParent = path.join(root, 'real')
      const alias = path.join(root, 'alias')
      mkdirSync(realParent)
      symlinkSync(realParent, alias, 'dir')
      const workspace = path.join(alias, 'workspace')
      if (!archived) mkdirSync(workspace)
      const resolved = path.join(realpathSync(realParent), 'workspace')
      expect(path.resolve(workspace)).not.toBe(resolved)
      const project = claudeProjectDirectoryName(resolved)
      const transcript = seedFile(`${projects}/${project}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl`)
      makeStale(path.join(root, projects))

      const { removed } = await claudeDriver().reclaimOrphanSessions!(
        {
          resumeTokens: new Set(),
          liveWorkspacePaths: new Set([workspace])
        },
        OPTIONS
      )

      expect(removed).toEqual([])
      expect(existsSync(transcript)).toBe(true)
    }
  )

  it.skipIf(process.platform !== 'darwin')('protects the SDK NFC project spelling on macOS', async () => {
    const workspace = path.join(root, 'cafe\u0301')
    mkdirSync(workspace)
    const resolved = realpathSync(workspace)
    const nfc = resolved.normalize('NFC')
    expect(nfc).not.toBe(resolved)
    const project = claudeProjectDirectoryName(nfc)
    const transcript = seedFile(`${projects}/${project}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl`)
    makeStale(path.join(root, projects))

    const { removed } = await claudeDriver().reclaimOrphanSessions!(
      {
        resumeTokens: new Set(),
        liveWorkspacePaths: new Set([workspace])
      },
      OPTIONS
    )

    expect(removed).toEqual([])
    expect(existsSync(transcript)).toBe(true)
  })

  it('retains a fresh Claude artifact', async () => {
    const transcript = seedFile(`${projects}/unowned/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl`, (NOW - 60_000) / 1000)
    const result = await claudeDriver().reclaimOrphanSessions!(
      {
        resumeTokens: new Set(),
        liveWorkspacePaths: new Set()
      },
      OPTIONS
    )
    expect(result.removed).toEqual([])
    expect(existsSync(transcript)).toBe(true)
  })

  it('no-ops when the runtime was never used', async () => {
    await expect(
      claudeDriver().reclaimOrphanSessions!({ resumeTokens: new Set(), liveWorkspacePaths: new Set() }, OPTIONS)
    ).resolves.toEqual({ removed: [] })
  })
})

describe('claude-code reclaimPurgedSessions', () => {
  const projects = 'feature.agents.claude.projects'

  function claudeDriver() {
    runtimeDriverRegistry.clearForTest()
    registerRuntimeDrivers()
    const driver = runtimeDriverRegistry.getAgentSessionDriver('claude-code')
    if (!driver?.reclaimPurgedSessions) throw new Error('claude-code driver missing reclaimPurgedSessions')
    return driver
  }

  afterEach(() => runtimeDriverRegistry.clearForTest())

  it('immediately removes only the named fresh transcript and directory while another token keeps the project', async () => {
    const projectDir = path.join(root, projects, '-tmp-work')
    const purged = seedFile(`${projects}/-tmp-work/purged.jsonl`, NOW / 1000)
    const subagent = seedFile(`${projects}/-tmp-work/purged/agent-1.jsonl`, NOW / 1000)
    const other = seedFile(`${projects}/-tmp-work/other.jsonl`, NOW / 1000)

    await claudeDriver().reclaimPurgedSessions!(new Set(['purged']))

    expect(existsSync(purged)).toBe(false)
    expect(existsSync(subagent)).toBe(false)
    expect(existsSync(other)).toBe(true)
    expect(existsSync(projectDir)).toBe(true)
  })

  it('removes the project directory when its last token is reclaimed', async () => {
    const projectDir = path.join(root, projects, '-tmp-work')
    seedFile(`${projects}/-tmp-work/purged.jsonl`)
    seedFile(`${projects}/-tmp-work/purged/agent-1.jsonl`)

    await claudeDriver().reclaimPurgedSessions!(new Set(['purged']))

    expect(existsSync(projectDir)).toBe(false)
  })

  it('no-ops for an empty token set or a missing root', async () => {
    const untouched = seedFile(`${projects}/-tmp-work/other.jsonl`)
    await claudeDriver().reclaimPurgedSessions!(new Set())
    expect(existsSync(untouched)).toBe(true)
    rmSync(path.join(root, projects), { recursive: true })
    await expect(claudeDriver().reclaimPurgedSessions!(new Set(['purged']))).resolves.toEqual({ removed: [] })
  })
})
