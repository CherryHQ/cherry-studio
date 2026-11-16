// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

describe('PiPromptField', () => {
  it('shows the prompt as titled blocks, with live data read-only and labelled with what updates it', async () => {
    answerWithDraft()
    render(<Harness initial="Review code." />)

    const skills = await screen.findByRole('region', { name: '技能' })
    expect(within(skills).getByText('skills=')).toBeInTheDocument()
    expect(within(skills).getByText('随启用的技能更新')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '回复语言' })).getByText('跟随回复语言设置')).toBeInTheDocument()
    expect(screen.getByRole('textbox', INSTRUCTIONS)).toHaveValue('Review code.')
  })

  // The create wizard has no Agent to save overrides on, so guidance stays read-only there.
  it('keeps guidance read-only when overrides cannot be saved', async () => {
    answerWithDraft()
    render(<Harness />)

    await screen.findByRole('region', { name: REPORT })
    expect(screen.getAllByRole('textbox')).toEqual([screen.getByRole('textbox', INSTRUCTIONS)])
  })

  it('saves an edited guidance block as an override and restores the generated text', async () => {
    answerWithDraft()
    const user = userEvent.setup()
    render(<Harness withOverrides />)
    const block = await screen.findByRole('textbox', { name: REPORT })
    expect(block).toHaveValue(GENERATED_REPORT)

    await user.clear(block)
    await user.type(block, 'Mine.')

    expect(screen.getByText('overrides: {"report_artifacts":"Mine."}')).toBeInTheDocument()
    const region = screen.getByRole('region', { name: REPORT })
    expect(within(region).getByText('已修改')).toBeInTheDocument()

    await user.click(within(region).getByRole('button', { name: '恢复自动生成' }))

    expect(screen.getByText('overrides: {}')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: REPORT })).toHaveValue(GENERATED_REPORT)
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

  it('optimizes one guidance block with AI, leaving the others as they were', async () => {
    answerWithDraft()
    fetchGenerate.mockResolvedValue('## Reporting deliverables\n\nReport every final file.')
    const user = userEvent.setup()
    render(<Harness withOverrides initial="Review code." />)
    const region = await screen.findByRole('region', { name: REPORT })

    await user.click(within(region).getByRole('button', { name: /润色提示词/ }))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: REPORT })).toHaveValue(
        '## Reporting deliverables\n\nReport every final file.'
      )
    )
    expect(screen.getByRole('textbox', INSTRUCTIONS)).toHaveValue('Review code.')
    expect(fetchGenerate).toHaveBeenCalledWith(expect.objectContaining({ content: GENERATED_REPORT }))
  })

  it('reassembles the prompt when skills or the reply language change', async () => {
    answerWithDraft()
    const { rerender } = render(<Harness />)
    expect(await screen.findByText('skills=')).toBeInTheDocument()

    rerender(<Harness draft={{ ...baseDraft, skillIds: ['release-notes'] }} />)
    expect(await screen.findByText('skills=release-notes')).toBeInTheDocument()

    rerender(<Harness draft={{ ...baseDraft, skillIds: ['release-notes'], languageMode: 'off' }} />)
    expect(await screen.findByText('language=null')).toBeInTheDocument()
  })

  it('reports a failed assembly and recovers on retry, keeping the instructions editable', async () => {
    request.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(<Harness initial="Review code." />)

    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument()
    expect(screen.getByRole('textbox', INSTRUCTIONS)).toHaveValue('Review code.')

    answerWithDraft()
    await user.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(screen.getByText('skills=')).toBeInTheDocument())
    expect(screen.queryByText(LOAD_FAILED)).not.toBeInTheDocument()
  })
})
