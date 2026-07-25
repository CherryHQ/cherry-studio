import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AgentSessionLiveIndex } from '../../types'
import { sweepConfigRoot } from '../sessionFileSweep'

const LIVE_SESSION = 'aaaaaaaa-0000-4000-8000-000000000001'
const DEAD_SESSION = 'aaaaaaaa-0000-4000-8000-000000000002'
const LIVE_TOKEN = 'bbbbbbbb-0000-4000-8000-000000000001'
const DEAD_TOKEN = 'bbbbbbbb-0000-4000-8000-000000000002'
const FRESH_DEAD_TOKEN = 'bbbbbbbb-0000-4000-8000-000000000003'

const WORKSPACES_ROOT = '/Users/tester/Library/App/Data/Agents'
const ENCODED_WORKSPACES_ROOT = '-Users-tester-Library-App-Data-Agents'
const USER_PROJECT = '-Users-tester-my-project'

const live: AgentSessionLiveIndex = {
  isSessionLive: (id) => id === LIVE_SESSION,
  isResumeTokenLive: (token) => token === LIVE_TOKEN
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

describe('sweepConfigRoot', () => {
  let root: string
  const aged = new Date(Date.now() - 25 * 60 * 60 * 1000)

  async function agedFile(target: string, content = '{}') {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
    await fs.utimes(target, aged, aged)
  }

  async function agedDir(target: string) {
    await fs.mkdir(target, { recursive: true })
    await fs.utimes(target, aged, aged)
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-sweep-'))
    // System-workspace project dirs — judged by Cherry session id.
    await agedFile(path.join(root, 'projects', `${ENCODED_WORKSPACES_ROOT}-${LIVE_SESSION}`, `${LIVE_TOKEN}.jsonl`))
    await agedFile(path.join(root, 'projects', `${ENCODED_WORKSPACES_ROOT}-${DEAD_SESSION}`, `${DEAD_TOKEN}.jsonl`))
    // Shared user-workspace project dir — judged per token.
    const userProject = path.join(root, 'projects', USER_PROJECT)
    await agedFile(path.join(userProject, `${LIVE_TOKEN}.jsonl`))
    await agedFile(path.join(userProject, `${DEAD_TOKEN}.jsonl`))
    await agedFile(path.join(userProject, DEAD_TOKEN, 'subagents', 'agent-a1b2c3.jsonl'))
    await fs.utimes(path.join(userProject, DEAD_TOKEN), aged, aged)
    await fs.writeFile(path.join(userProject, `${FRESH_DEAD_TOKEN}.jsonl`), '{}')
    await agedFile(path.join(userProject, 'sessions-index.json'))
    await agedDir(path.join(userProject, 'memory'))
    // Per-token stores.
    for (const store of ['session-env', 'file-history', 'tasks']) {
      await agedDir(path.join(root, store, LIVE_TOKEN))
      await agedDir(path.join(root, store, DEAD_TOKEN))
    }
    await agedFile(path.join(root, 'todos', `${LIVE_TOKEN}-agent-${LIVE_TOKEN}.json`), '[]')
    await agedFile(path.join(root, 'todos', `${DEAD_TOKEN}-agent-a1b2c3.json`), '[]')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('sweeps orphans in the app-managed root, keeping live and recent entries', async () => {
    await sweepConfigRoot(root, live, { workspacesRoot: WORKSPACES_ROOT })

    expect(await exists(path.join(root, 'projects', `${ENCODED_WORKSPACES_ROOT}-${LIVE_SESSION}`))).toBe(true)
    expect(await exists(path.join(root, 'projects', `${ENCODED_WORKSPACES_ROOT}-${DEAD_SESSION}`))).toBe(false)

    const userProject = path.join(root, 'projects', USER_PROJECT)
    expect(await exists(path.join(userProject, `${LIVE_TOKEN}.jsonl`))).toBe(true)
    expect(await exists(path.join(userProject, `${DEAD_TOKEN}.jsonl`))).toBe(false)
    expect(await exists(path.join(userProject, DEAD_TOKEN))).toBe(false)
    // Recently written orphan: may belong to in-flight state the index can't see yet.
    expect(await exists(path.join(userProject, `${FRESH_DEAD_TOKEN}.jsonl`))).toBe(true)
    // Non-per-session entries are never judged.
    expect(await exists(path.join(userProject, 'sessions-index.json'))).toBe(true)
    expect(await exists(path.join(userProject, 'memory'))).toBe(true)

    for (const store of ['session-env', 'file-history', 'tasks']) {
      expect(await exists(path.join(root, store, LIVE_TOKEN))).toBe(true)
      expect(await exists(path.join(root, store, DEAD_TOKEN))).toBe(false)
    }
    expect(await exists(path.join(root, 'todos', `${LIVE_TOKEN}-agent-${LIVE_TOKEN}.json`))).toBe(true)
    expect(await exists(path.join(root, 'todos', `${DEAD_TOKEN}-agent-a1b2c3.json`))).toBe(false)
  })

  it('is a no-op on a missing root', async () => {
    await expect(
      sweepConfigRoot(path.join(root, 'nope'), live, { workspacesRoot: WORKSPACES_ROOT })
    ).resolves.toBeUndefined()
  })
})
