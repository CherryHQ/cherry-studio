import '@data/services/AgentGlobalSkillService'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { createAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import type { AgentSystemPromptDraft } from '@shared/ipc/schemas/agent'

import { loadPiSdk } from '../pi/piSdk'
import { buildDurablePrompt, renderDurablePrompt } from './durablePrompt'
import { previewDurableSystemPrompt } from './durablePromptPreview'

describe('previewDurableSystemPrompt', () => {
  const dbh = setupTestDatabase()
  const model = 'preview-test::test-model'
  let root: string

  const draft = (patch: Partial<AgentSystemPromptDraft> = {}): AgentSystemPromptDraft => ({
    instructions: 'Review pull requests and cite the changed lines.',
    language: 'English',
    skillIds: [],
    disabledTools: [],
    knowledgeBaseIds: [],
    mcpServerIds: [],
    ...patch
  })
  const fullText = ({ before, after }: { before: string; after: string }, instructions: string) =>
    `${before}${instructions}${after}`

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'durable-prompt-preview-'))
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) =>
      path.join(root, key, filename ?? '')
    )
    dbh.db.insert(userProviderTable).values({ providerId: 'preview-test', name: 'Test', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: model,
        providerId: 'preview-test',
        modelId: 'test-model',
        name: 'Test',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function seedSkill(id: string, folderName: string, description: string) {
    dbh.db
      .insert(agentGlobalSkillTable)
      .values({ id, name: folderName, folderName, source: 'local', contentHash: id, isEnabled: true })
      .run()
    const directory = application.getPath('feature.agents.skills', folderName)
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SKILL.md'),
      `---\nname: ${folderName}\ndescription: ${description}\n---\n\nSteps.`
    )
  }

  it('reproduces what the runtime sends for a saved Agent, with its instructions in the editable slot', async () => {
    const id = randomUUID()
    const agentDataPath = await createAgentDataDirectory(application.getPath('feature.agents.data'), id)
    await writeFile(path.join(agentDataPath, 'SOUL.md'), 'I am Cedar, concise and warm.')
    await seedSkill('skill-1', 'release-notes', 'Write release notes from merged changes.')
    const instructions = 'Review pull requests and cite the changed lines.'
    const agent = agentService.createAgentWithId(id, {
      type: 'pi-durable',
      name: 'Reviewer',
      model,
      instructions,
      configuration: { bootstrap_completed: true, language: 'English' }
    })

    const preview = await previewDurableSystemPrompt(draft({ agentId: id, skillIds: ['skill-1'] }))

    const runtime = await renderDurablePrompt(
      await buildDurablePrompt(await loadPiSdk(), {
        agent,
        cwd: application.getPath('feature.agents.system_workspaces'),
        agentDataPath,
        effectiveLanguage: 'English',
        disabledTools: new Set(),
        knowledgeBaseScope: [],
        skillPaths: [application.getPath('feature.agents.skills', 'release-notes')]
      })
    )
    expect(fullText(preview, instructions)).toBe(runtime)
    expect(preview.before).toMatch(/<agent_instructions>\n$/)
    expect(preview.after).toMatch(/^\n<\/agent_instructions>/)
    expect(preview.before).toContain('I am Cedar, concise and warm.')
    expect(fullText(preview, instructions)).not.toContain('## Bootstrap Mode')
  })

  it('omits the sections that depend on instructions when they are empty, as the runtime does', async () => {
    const preview = await previewDurableSystemPrompt(draft({ instructions: '  ' }))
    const text = `${preview.before}${preview.after}`

    expect(text).not.toContain('## Instruction Precedence')
    expect(text).not.toContain('<agent_instructions>')
    expect(text).toContain('**Discover the role**')
    const runtime = await renderDurablePrompt(
      await buildDurablePrompt(await loadPiSdk(), {
        agent: { instructions: '', configuration: {}, modelName: null },
        cwd: application.getPath('feature.agents.system_workspaces'),
        agentDataPath: path.join(application.getPath('feature.agents.data'), '{agent-id}'),
        effectiveLanguage: 'English',
        disabledTools: new Set(),
        knowledgeBaseScope: [],
        skillPaths: []
      })
    )
    expect(text).toBe(runtime)
  })

  it('includes onboarding for a new Agent with instructions', async () => {
    const preview = await previewDurableSystemPrompt(draft())

    expect(preview.before).toContain('## Instruction Precedence')
    expect(preview.after).toContain('## Bootstrap Mode')
    expect(preview.after).toContain('**Discover your presentation**')
  })

  it('follows the reply language and enabled skills of the draft', async () => {
    await seedSkill('skill-1', 'release-notes', 'Write release notes from merged changes.')

    const english = await previewDurableSystemPrompt(draft())
    const off = await previewDurableSystemPrompt(draft({ language: null }))
    const withSkill = await previewDurableSystemPrompt(draft({ skillIds: ['skill-1'] }))

    expect(english.after).toContain('By default, respond in English.')
    expect(off.after).not.toContain('By default, respond in')
    expect(english.before).not.toContain('Write release notes from merged changes.')
    expect(withSkill.before).toContain('Write release notes from merged changes.')
  })

  it('rejects an Agent that does not exist', async () => {
    await expect(previewDurableSystemPrompt(draft({ agentId: 'missing' }))).rejects.toThrow('Agent not found')
  })
})
