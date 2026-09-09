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
import { describe, expect, it } from 'vitest'

async function createSession(excludeTools?: string[]) {
  const cwd = process.cwd()
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
