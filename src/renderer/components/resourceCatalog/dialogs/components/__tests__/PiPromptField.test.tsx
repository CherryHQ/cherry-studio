// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { AGENT_INSTRUCTIONS_SLOT, type AgentPromptOverrides } from '@shared/ai/agentPromptSections'
import type { AgentSystemPromptDraft } from '@shared/ipc/schemas/agent'

import { PiPromptField, type PiPromptDraft } from '../PiPromptField'

const request = vi.hoisted(() => vi.fn())
const fetchGenerate = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())
vi.mock('@renderer/utils/aiGeneration', () => ({ fetchGenerate }))
vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: { id: 'm', name: 'Model' }, isDefaultModelLoading: false })
}))

// The renderer test locale is zh-CN.
const INSTRUCTIONS = { name: '智能体系统提示词' }
const REPORT = '汇报产物'
const LOAD_FAILED = '无法生成完整的系统提示词'
const GENERATED_REPORT = '## Reporting deliverables\n\nCall report_artifacts.'
const baseDraft: PiPromptDraft = {
  skillIds: [],
  disabledTools: [],
  knowledgeBaseIds: [],
  mcpServerIds: [],
  languageMode: 'inherit',
  languageCustom: ''
}

/** Echoes the draft into the live blocks so a test can see which draft a preview came from. */
function answerWithDraft(builtinInstructions?: string) {
  request.mockImplementation(async (_route: string, input: AgentSystemPromptDraft) => ({
    blocks: [
      { key: 'skills', kind: 'live', text: `skills=${input.skillIds.join(',')}` },
      { key: 'report_artifacts', kind: 'guidance', text: GENERATED_REPORT },
      {
        key: 'instructions',
        kind: 'instructions',
        text: `<agent_instructions>\n${AGENT_INSTRUCTIONS_SLOT}\n</agent_instructions>`
      },
      { key: 'language', kind: 'setting', text: `language=${String(input.language)}` }
    ],
    ...(builtinInstructions ? { builtinInstructions } : {})
  }))
}

function Harness({
  draft = baseDraft,
  initial = '',
  withOverrides = false
}: {
  draft?: PiPromptDraft
  initial?: string
  withOverrides?: boolean
}) {
  const [value, setValue] = useState(initial)
  const [overrides, setOverrides] = useState<AgentPromptOverrides>({})
  return (
    <>
      <PiPromptField
        value={value}
        onChange={setValue}
        draft={draft}
        {...(withOverrides ? { overrides, onOverridesChange: setOverrides } : {})}
      />
      <p>saved: {value}</p>
      <p>overrides: {JSON.stringify(overrides)}</p>
    </>
  )
}

beforeEach(() => {
  request.mockReset()
  fetchGenerate.mockReset()
})

afterEach(() => {
  cleanup()
})

const openSection = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('button', { name: new RegExp(`^${name}(:|$)`) }))

describe('PiPromptField', () => {
  it('leads with the Agent prompt and lists the other blocks, marking those it cannot change', async () => {
    answerWithDraft()
    render(<Harness initial="Review code." withOverrides />)

    expect(await screen.findByRole('button', { name: REPORT })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '技能: 只读' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回复语言: 只读' })).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toEqual([screen.getByRole('textbox', INSTRUCTIONS)])
    expect(screen.getByRole('textbox', INSTRUCTIONS)).toHaveValue('Review code.')
  })

  it('opens a live block read-only with what keeps it current, and goes back', async () => {
    answerWithDraft()
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByRole('button', { name: '技能: 只读' })

    await openSection(user, '技能')

    expect(screen.getByText('随启用的技能更新')).toBeInTheDocument()
    expect(screen.getByText('skills=')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '技能' }))
    expect(screen.getByRole('textbox', INSTRUCTIONS)).toBeInTheDocument()
  })

  // The create wizard has no Agent to save overrides on, so guidance stays read-only there.
  it('shows guidance read-only when overrides cannot be saved', async () => {
    answerWithDraft()
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByRole('button', { name: `${REPORT}: 只读` })

    await openSection(user, REPORT)

    expect(screen.getByText(/Call report_artifacts/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('saves an edited guidance block as an override and restores the generated text', async () => {
    answerWithDraft()
    const user = userEvent.setup()
    render(<Harness withOverrides />)
    await screen.findByRole('button', { name: REPORT })
    await openSection(user, REPORT)
    const block = screen.getByRole('textbox', { name: REPORT })
    expect(block).toHaveValue(GENERATED_REPORT)

    await user.clear(block)
    await user.type(block, 'Mine.')
    expect(screen.getByText('overrides: {"report_artifacts":"Mine."}')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '恢复自动生成' }))

    expect(screen.getByText('overrides: {}')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: REPORT })).toHaveValue(GENERATED_REPORT)
  })

  it('marks an edited block in the list', async () => {
    answerWithDraft()
    const user = userEvent.setup()
    render(<Harness withOverrides />)
    await screen.findByRole('button', { name: REPORT })
    await openSection(user, REPORT)
    await user.type(screen.getByRole('textbox', { name: REPORT }), ' More.')

    await user.click(screen.getByRole('button', { name: REPORT }))

    expect(screen.getByRole('button', { name: `${REPORT}: 已修改` })).toBeInTheDocument()
  })

  it('shows a built-in Agent its built-in prompt and restores it after an edit', async () => {
    answerWithDraft('You are Cherry Assistant.')
    const user = userEvent.setup()
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('textbox', INSTRUCTIONS)).toHaveValue('You are Cherry Assistant.'))
    expect(screen.queryByRole('button', { name: '恢复内置提示词' })).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', INSTRUCTIONS), ' Be brief.')
    expect(screen.getByText('saved: You are Cherry Assistant. Be brief.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '恢复内置提示词' }))

    expect(screen.getByText(/^saved:\s*$/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', INSTRUCTIONS)).toHaveValue('You are Cherry Assistant.')
  })

  it('optimizes one guidance block with AI, leaving the Agent prompt as it was', async () => {
    answerWithDraft()
    fetchGenerate.mockResolvedValue('## Reporting deliverables\n\nReport every final file.')
    const user = userEvent.setup()
    render(<Harness withOverrides initial="Review code." />)
    await screen.findByRole('button', { name: REPORT })
    await openSection(user, REPORT)

    await user.click(screen.getByRole('button', { name: /润色提示词/ }))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: REPORT })).toHaveValue(
        '## Reporting deliverables\n\nReport every final file.'
      )
    )
    expect(screen.getByText('saved: Review code.')).toBeInTheDocument()
    expect(fetchGenerate).toHaveBeenCalledWith(expect.objectContaining({ content: GENERATED_REPORT }))
  })

  it('reassembles the prompt when skills change', async () => {
    answerWithDraft()
    const user = userEvent.setup()
    const { rerender } = render(<Harness />)
    await screen.findByRole('button', { name: '技能: 只读' })
    await openSection(user, '技能')
    expect(screen.getByText('skills=')).toBeInTheDocument()

    rerender(<Harness draft={{ ...baseDraft, skillIds: ['release-notes'] }} />)

    expect(await screen.findByText('skills=release-notes')).toBeInTheDocument()
  })

  it('reports a failed assembly and recovers on retry, keeping the instructions editable', async () => {
    request.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(<Harness initial="Review code." />)

    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument()
    expect(screen.getByRole('textbox', INSTRUCTIONS)).toHaveValue('Review code.')

    answerWithDraft()
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByRole('button', { name: '技能: 只读' })).toBeInTheDocument()
    expect(screen.queryByText(LOAD_FAILED)).not.toBeInTheDocument()
  })
})
