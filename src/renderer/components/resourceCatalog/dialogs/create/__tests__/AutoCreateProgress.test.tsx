import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstalledSkill, SkillSearchResult } from '@shared/types/skill'

const { mockFetchGenerate, mockInstallSkill, mockSearchSkills } = vi.hoisted(() => ({
  mockFetchGenerate: vi.fn(),
  mockInstallSkill: vi.fn(),
  mockSearchSkills: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/utils/aiGeneration', () => ({ fetchGenerate: mockFetchGenerate }))
vi.mock('@renderer/utils/skillSearch', () => ({ searchSkills: mockSearchSkills }))
vi.mock('@renderer/hooks/useSkills', () => ({ useSkillInstall: () => ({ install: mockInstallSkill }) }))

import { type AutoCreateInput, AutoCreateProgress } from '../AutoCreateProgress'

const INPUT: AutoCreateInput = {
  avatar: '🤖',
  agentType: 'pi-durable',
  permissionMode: 'auto',
  name: 'Slide Expert',
  modelId: 'provider::model',
  description: 'Turn meeting notes into slides'
}

function makeSkill(id: string, overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    id,
    name: id,
    description: null,
    folderName: id,
    source: 'local',
    sourceUrl: null,
    namespace: null,
    author: null,
    version: null,
    sourceTags: [],
    contentHash: id,
    isGlobalEnabled: true,
    isEnabled: false,
    mirrorEnabled: false,
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    ...overrides
  }
}

function renderProgress(props: Partial<Parameters<typeof AutoCreateProgress>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const onBack = vi.fn()
  const onRunningChange = vi.fn()
  render(
    <AutoCreateProgress
      input={INPUT}
      onSubmit={onSubmit}
      onBack={onBack}
      onRunningChange={onRunningChange}
      {...props}
    />
  )
  return { onSubmit, onBack, onRunningChange }
}

beforeEach(() => {
  MockDataApiUtils.resetMocks()
  MockDataApiUtils.setCustomResponse('/skills', 'GET', [])
  mockFetchGenerate.mockReset()
  mockSearchSkills.mockReset()
  mockSearchSkills.mockResolvedValue([])
  mockInstallSkill.mockReset()
})

const PPTX_RESULT: SkillSearchResult = {
  slug: 'pptx',
  name: 'pptx',
  description: 'Create and edit PowerPoint decks',
  author: null,
  stars: 0,
  downloads: 900,
  sourceRegistry: 'skills.sh',
  sourceUrl: null,
  installSource: 'skills.sh:pptx'
}

/** Answer each model call by its role: prompt writing, marketplace queries, or the final pick. */
function answerModelCalls() {
  mockFetchGenerate.mockImplementation(async ({ prompt }: { prompt: string }) => {
    if (prompt.includes('search queries')) return '["pptx"]'
    if (prompt.includes('numbered list')) return '[1]'
    return 'prompt'
  })
}

afterEach(cleanup)

describe('AutoCreateProgress', () => {
  it('creates the Agent with the generated prompt and every globally enabled, non-builtin skill', async () => {
    MockDataApiUtils.setCustomResponse('/skills', 'GET', [
      makeSkill('skill-creator', { source: 'builtin' }),
      makeSkill('pdf'),
      makeSkill('disabled-globally', { isGlobalEnabled: false }),
      makeSkill('pptx', { source: 'marketplace' })
    ])
    mockFetchGenerate.mockResolvedValue('## Role\nYou turn meeting notes into slides.')

    const { onSubmit } = renderProgress()

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        ...INPUT,
        prompt: '## Role\nYou turn meeting notes into slides.',
        skillIds: ['pdf', 'pptx'],
        knowledgeBaseIds: [],
        setupIncomplete: false
      })
    )
  })

  it('uses the purpose as the prompt and says so when generation fails', async () => {
    mockFetchGenerate.mockRejectedValue(new Error('model unavailable'))

    const { onSubmit } = renderProgress()

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'Turn meeting notes into slides', setupIncomplete: true })
      )
    )
    expect(screen.getByText('library.config.dialogs.create.auto.step.prompt_fallback')).toBeInTheDocument()
  })

  it('uses the name as the prompt when there is no purpose and generation returns nothing', async () => {
    mockFetchGenerate.mockResolvedValue('   ')

    const { onSubmit } = renderProgress({ input: { ...INPUT, description: '' } })

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Slide Expert' })))
  })

  it('still creates the Agent when the installed skills cannot be listed', async () => {
    MockDataApiUtils.setErrorResponse('/skills', 'GET', new Error('db busy'))
    mockFetchGenerate.mockResolvedValue('prompt')

    const { onSubmit } = renderProgress()

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ skillIds: [] })))
  })

  it('shows a failed create and lets the user go back once the run has stopped', async () => {
    const user = userEvent.setup()
    mockFetchGenerate.mockResolvedValue('prompt')
    const onSubmit = vi.fn().mockRejectedValue(new Error('An Agent with this name already exists'))

    const { onBack, onRunningChange } = renderProgress({ onSubmit })

    expect(await screen.findByText('An Agent with this name already exists')).toBeInTheDocument()
    expect(onRunningChange).toHaveBeenLastCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'library.config.dialogs.create.back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('installs the recommended marketplace skill and enables it for the new Agent', async () => {
    answerModelCalls()
    mockSearchSkills.mockResolvedValue([PPTX_RESULT])
    mockInstallSkill.mockResolvedValue({ skill: makeSkill('installed-pptx', { name: 'pptx', source: 'marketplace' }) })

    const { onSubmit } = renderProgress()

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ skillIds: ['installed-pptx'] }))
    )
    expect(mockInstallSkill).toHaveBeenCalledWith('skills.sh:pptx')
    expect(screen.getByText('library.config.dialogs.create.auto.step.recommend_installed')).toBeInTheDocument()
  })

  it('still creates the Agent and reports it when the recommended install fails', async () => {
    answerModelCalls()
    MockDataApiUtils.setCustomResponse('/skills', 'GET', [makeSkill('pdf')])
    mockSearchSkills.mockResolvedValue([PPTX_RESULT])
    mockInstallSkill.mockResolvedValue({ skill: null, error: 'clone failed' })

    const { onSubmit } = renderProgress()

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ skillIds: ['pdf'] })))
    expect(screen.getByText('library.config.dialogs.create.auto.step.recommend_failed')).toBeInTheDocument()
  })
})
