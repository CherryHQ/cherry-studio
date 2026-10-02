import { mkdir, mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  AuthStorage,
  createAgentSession,
  createBashToolDefinition,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { forkPiSession } from './piFork'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function createSession(excludeTools?: string[]) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'cherry-pi-sdk-contract-'))
  directories.push(cwd)
  const settingsManager = SettingsManager.inMemory()
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true
  })
  await resourceLoader.reload()
  const authStorage = AuthStorage.inMemory()
  const modelRegistry = ModelRegistry.inMemory(authStorage)
  const managedBash = createBashToolDefinition(cwd, { spawnHook: (context) => context }) as ToolDefinition
  const { session } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    tools: ['bash'],
    customTools: [managedBash],
    excludeTools
  })
  return { managedBash, session }
}

describe('Pi managed Bash SDK contract', () => {
  it.each([false, true])('forks at the exact leaf (older duplicate: %s)', async (duplicate) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cherry-pi-native-fork-'))
    directories.push(directory)
    const sessions = path.join(directory, 'sessions')
    await mkdir(sessions)
    const originalPath = application.getPath.bind(application)
    vi.spyOn(application, 'getPath').mockImplementation((key, ...args) =>
      key === 'feature.agents.pi.sessions' ? sessions : originalPath(key, ...args)
    )
    const manager = SessionManager.create(directory, sessions)
    if (duplicate)
      await writeFile(
        path.join(sessions, `2000-01-01T00-00-00-000Z_${manager.getSessionId()}.jsonl`),
        JSON.stringify(manager.getHeader()) + '\n'
      )
    manager.appendMessage({ role: 'user', content: 'PAST_ONLY', timestamp: 1 })
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'COMPLETED_PAST' }],
      api: 'openai-completions',
      provider: 'fixture',
      model: 'fixture',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    const checkpoint = {
      runtime: 'pi' as const,
      runtimeSessionId: manager.getSessionId(),
      leafId: manager.getLeafId()!
    }
    manager.appendMessage({ role: 'user', content: 'FUTURE_SECRET', timestamp: 3 })
    const sourceIdentity = { id: manager.getSessionId(), file: manager.getSessionFile(), leaf: manager.getLeafId() }
    let current = checkpoint
    for (const name of ['child', 'grandchild']) {
      const artifacts = path.join(directory, name)
      await mkdir(artifacts)
      const result = await forkPiSession({
        sourceSessionId: 'source',
        checkpoint: current,
        checkpoints: [current],
        targetSessionId: name,
        targetCwd: directory,
        artifactDirectory: artifacts,
        signal: new AbortController().signal
      })
      await copyFile(result.publish[0].source, result.publish[0].target)
      const child = SessionManager.open(result.publish[0].target, sessions, directory)
      expect(JSON.stringify(child.buildSessionContext().messages)).toContain('PAST_ONLY')
      expect(JSON.stringify(child.buildSessionContext().messages)).not.toContain('FUTURE_SECRET')
      expect({ id: manager.getSessionId(), file: manager.getSessionFile(), leaf: manager.getLeafId() }).toEqual(
        sourceIdentity
      )
      current = result.checkpoints[0] as typeof checkpoint
      if (name === 'child') await rm(sourceIdentity.file!)
    }
  })
  it('uses the managed custom definition when enabled and removes it when bash is excluded', async () => {
    const enabled = await createSession()

    try {
      const disabled = await createSession(['bash'])
      try {
        expect(enabled.session.getToolDefinition('bash')).toBe(enabled.managedBash)
        expect(enabled.session.getActiveToolNames()).toContain('bash')

        expect(disabled.session.getToolDefinition('bash')).toBeUndefined()
        expect(disabled.session.getActiveToolNames()).not.toContain('bash')
        expect(disabled.session.getAllTools().map((tool) => tool.name)).not.toContain('bash')
      } finally {
        disabled.session.dispose()
      }
    } finally {
      enabled.session.dispose()
    }
  })
})
