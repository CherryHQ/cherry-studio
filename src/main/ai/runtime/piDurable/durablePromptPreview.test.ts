import '@data/services/AgentGlobalSkillService'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { createAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { AGENT_INSTRUCTIONS_SLOT } from '@shared/ai/agentPromptSections'
import type { AgentSystemPromptDraft, AgentSystemPromptPreview } from '@shared/ipc/schemas/agent'

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
  // Pi Durable renders its extension sections as `<key>` blocks, then every other block inside <instructions>.
  const HARNESS_SECTIONS = new Set(['agent_identity', 'project_context', 'skills', 'mcp_instructions'])
  const fullText = ({ blocks }: AgentSystemPromptPreview, instructions: string) =>
    [
      ...blocks
        .filter((block) => HARNESS_SECTIONS.has(block.key))
        .map(({ key, text }) => `<${key}>\n${text}\n</${key}>`),
      `<instructions>\n${blocks
        .filter((block) => !HARNESS_SECTIONS.has(block.key))
        .map((block) => block.text.replace(AGENT_INSTRUCTIONS_SLOT, instructions))
        .filter(Boolean)
        .join('\n\n')}\n</instructions>`
    ].join('\n\n')
  const block = ({ blocks }: AgentSystemPromptPreview, key: string) => blocks.find((item) => item.key === key)

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'durable-prompt-preview-'))
    // Built-in Agent templates are bundled resources, not per-test files.
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) =>
      key === 'feature.agents.builtin'
        ? path.resolve('resources/builtin-agents', filename ?? '')
        : path.join(root, key, filename ?? '')
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
        channelLinked: false,
        disabledTools: new Set(),
        knowledgeBaseScope: [],
        skillPaths: [application.getPath('feature.agents.skills', 'release-notes')]
      })
    )
    expect(fullText(preview, instructions)).toBe(runtime)
    expect(block(preview, 'instructions')).toMatchObject({
      kind: 'instructions',
      text: expect.stringContaining(`<agent_instructions>\n${AGENT_INSTRUCTIONS_SLOT}\n</agent_instructions>`)
    })
    expect(block(preview, 'agent_identity')).toMatchObject({
      kind: 'live',
      text: expect.stringContaining('I am Cedar')
    })
    expect(runtime.match(/^<agent_identity>$/gm)).toHaveLength(1)
    expect(block(preview, 'bootstrap')).toBeUndefined()
  })

  it('omits the sections that depend on instructions when they are empty, as the runtime does', async () => {
    const preview = await previewDurableSystemPrompt(draft({ instructions: '  ' }))
    const text = fullText(preview, '')

    expect(text).not.toContain('## Instruction Precedence')
    expect(text).not.toContain('<agent_instructions>')
    expect(text).toContain('**Discover the role**')
    const runtime = await renderDurablePrompt(
      await buildDurablePrompt(await loadPiSdk(), {
        agent: { type: 'pi-durable', instructions: '', configuration: {}, modelName: null },
        cwd: application.getPath('feature.agents.system_workspaces'),
        agentDataPath: path.join(application.getPath('feature.agents.data'), '{agent-id}'),
        effectiveLanguage: 'English',
        channelLinked: false,
        disabledTools: new Set(),
        knowledgeBaseScope: [],
        skillPaths: []
      })
    )
    expect(text).toBe(runtime)
  })

  it('includes onboarding for a new Agent with instructions', async () => {
    const preview = await previewDurableSystemPrompt(draft())

    expect(block(preview, 'instruction_precedence')?.text).toContain('## Instruction Precedence')
    expect(block(preview, 'bootstrap')).toMatchObject({
      kind: 'guidance',
      text: expect.stringContaining('**Discover your presentation**')
    })
  })

  it('follows the reply language and enabled skills of the draft', async () => {
    await seedSkill('skill-1', 'release-notes', 'Write release notes from merged changes.')

    const english = await previewDurableSystemPrompt(draft())
    const off = await previewDurableSystemPrompt(draft({ language: null }))
    const withSkill = await previewDurableSystemPrompt(draft({ skillIds: ['skill-1'] }))

    expect(block(english, 'language')).toMatchObject({
      kind: 'setting',
      text: expect.stringContaining('respond in English')
    })
    expect(block(off, 'language')).toBeUndefined()
    expect(fullText(english, '')).not.toContain('Write release notes from merged changes.')
    expect(block(withSkill, 'skills')?.text).toContain('Write release notes from merged changes.')
  })

  it('shows the generated guidance while the Agent overrides it, and sends the override at run time', async () => {
    const id = randomUUID()
    const agentDataPath = await createAgentDataDirectory(application.getPath('feature.agents.data'), id)
    const agent = agentService.createAgentWithId(id, {
      type: 'pi-durable',
      name: 'Reviewer',
      model,
      instructions: 'Review pull requests.',
      configuration: {
        bootstrap_completed: true,
        // Citations are not generated without lookups, so that override must not be sent.
        prompt_overrides: { report_artifacts: 'Report files your own way.', citations: 'Cite nothing.' }
      }
    })
    const runtime = async (configuration: typeof agent.configuration) =>
      (
        await buildDurablePrompt(await loadPiSdk(), {
          agent: { ...agent, configuration },
          cwd: application.getPath('feature.agents.system_workspaces'),
          agentDataPath,
          effectiveLanguage: 'English',
          channelLinked: false,
          disabledTools: new Set(['mcp__cherry_tools__web_search', 'mcp__cherry_tools__web_fetch']),
          knowledgeBaseScope: [],
          skillPaths: []
        })
      ).instructions

    const preview = await previewDurableSystemPrompt(draft({ agentId: id }))
    const edited = await runtime(agent.configuration)
    const restored = await runtime({ ...agent.configuration, prompt_overrides: {} })

    expect(edited).toContain('Report files your own way.')
    expect(edited).not.toContain('## Reporting deliverables')
    expect(edited).not.toContain('Cite nothing.')
    expect(restored).toContain('## Reporting deliverables')
    expect(block(preview, 'report_artifacts')?.text).toContain('## Reporting deliverables')
  })

  it('sends an edited skills or reply language section in place of the generated one until it is restored', async () => {
    await seedSkill('skill-1', 'release-notes', 'Write release notes from merged changes.')
    const id = randomUUID()
    const agentDataPath = await createAgentDataDirectory(application.getPath('feature.agents.data'), id)
    const agent = agentService.createAgentWithId(id, {
      type: 'pi-durable',
      name: 'Reviewer',
      model,
      instructions: 'Review pull requests.',
      configuration: {
        bootstrap_completed: true,
        // No MCP server is enabled, so that section is not generated and its edit must not be sent.
        prompt_overrides: { skills: 'Use only my skills.', language: 'Reply in French.', mcp_instructions: 'MCP edit.' }
      }
    })
    await mkdir(application.getPath('feature.agents.system_workspaces'), { recursive: true })
    const runtime = async (configuration: typeof agent.configuration) =>
      renderDurablePrompt(
        await buildDurablePrompt(await loadPiSdk(), {
          agent: { ...agent, configuration },
          cwd: application.getPath('feature.agents.system_workspaces'),
          agentDataPath,
          effectiveLanguage: 'English',
          channelLinked: false,
          disabledTools: new Set(),
          knowledgeBaseScope: [],
          skillPaths: [application.getPath('feature.agents.skills', 'release-notes')]
        })
      )

    const edited = await runtime(agent.configuration)
    const restored = await runtime({ ...agent.configuration, prompt_overrides: {} })

    expect(edited).toContain('<skills>\nUse only my skills.\n</skills>')
    expect(edited).not.toContain('Write release notes from merged changes.')
    expect(edited).toContain('Reply in French.')
    expect(edited).not.toContain('respond in English')
    expect(edited).not.toContain('MCP edit.')
    expect(restored).toContain('Write release notes from merged changes.')
    expect(restored).toContain('respond in English')
  })

  // Catches the prompt still sending the model to codemode after the Agent disabled it.
  it('points Cherry tools at tool_search once codemode is disabled, and names no disabled tool', async () => {
    const id = randomUUID()
    const agentDataPath = await createAgentDataDirectory(application.getPath('feature.agents.data'), id)
    const agent = agentService.createAgentWithId(id, {
      type: 'pi-durable',
      name: 'Reviewer',
      model,
      instructions: 'Review pull requests.',
      configuration: { bootstrap_completed: true }
    })
    await mkdir(application.getPath('feature.agents.system_workspaces'), { recursive: true })
    const instructions = async (disabled: string[]) =>
      (
        await buildDurablePrompt(await loadPiSdk(), {
          agent,
          cwd: application.getPath('feature.agents.system_workspaces'),
          agentDataPath,
          effectiveLanguage: 'English',
          channelLinked: false,
          disabledTools: new Set(disabled),
          knowledgeBaseScope: [],
          skillPaths: []
        })
      ).instructions

    const withCodemode = await instructions([])
    const withoutCodemode = await instructions(['codemode', 'mcp__cherry_tools__config_update'])
    const unreachable = await instructions(['codemode', 'tool_search'])

    expect(withCodemode).toContain('`await tools.mcp__cherry_tools__agent_create({ ... })`')
    expect(withoutCodemode).toContain('load them with `tool_search` first')
    expect(withoutCodemode).toContain('`mcp__cherry_tools__agent_create`')
    expect(withoutCodemode).not.toContain('codemode')
    expect(withoutCodemode).not.toContain('config_update')
    expect(unreachable).not.toContain('mcp__cherry_tools__')
  })

  // Catches Context Usage listing a skill's file as loaded while the Agent's own text was sent instead.
  it('drops the files an override displaces from what Context Usage reports as loaded', async () => {
    await seedSkill('skill-1', 'release-notes', 'Write release notes from merged changes.')
    const id = randomUUID()
    const agentDataPath = await createAgentDataDirectory(application.getPath('feature.agents.data'), id)
    const agent = agentService.createAgentWithId(id, {
      type: 'pi-durable',
      name: 'Reviewer',
      model,
      instructions: 'Review pull requests.',
      configuration: { bootstrap_completed: true, prompt_overrides: { skills: 'Use only my skills.' } }
    })
    await mkdir(application.getPath('feature.agents.system_workspaces'), { recursive: true })
    const skillsSource = async (configuration: typeof agent.configuration) => {
      const { sections } = await buildDurablePrompt(await loadPiSdk(), {
        agent: { ...agent, configuration },
        cwd: application.getPath('feature.agents.system_workspaces'),
        agentDataPath,
        effectiveLanguage: 'English',
        channelLinked: false,
        disabledTools: new Set(),
        knowledgeBaseScope: [],
        skillPaths: [application.getPath('feature.agents.skills', 'release-notes')]
      })
      const rendered = await sections.find((section) => section.key === 'skills')!.render()
      return typeof rendered === 'object' ? rendered.source : undefined
    }

    const overridden = await skillsSource(agent.configuration)
    expect(overridden?.kind).toBe('skills')
    expect(overridden?.resources ?? []).toHaveLength(0)
    expect((await skillsSource({ ...agent.configuration, prompt_overrides: {} }))?.resources).not.toHaveLength(0)
  })

  it('returns the built-in prompt of a built-in Agent', async () => {
    // Built-in Agents are seeded, never created through the service.
    const { id } = dbh.db
      .insert(agentTable)
      .values({
        type: 'pi-durable',
        name: 'Cherry Assistant',
        instructions: '',
        orderKey: 'a0',
        configuration: { bootstrap_completed: true, builtin_role: 'assistant' }
      })
      .returning()
      .get()

    const preview = await previewDurableSystemPrompt(draft({ agentId: id, instructions: '' }))

    expect(preview.builtinInstructions).toContain('Cherry')
  })

  it('rejects an Agent that does not exist', async () => {
    await expect(previewDurableSystemPrompt(draft({ agentId: 'missing' }))).rejects.toThrow('Agent not found')
  })
})
