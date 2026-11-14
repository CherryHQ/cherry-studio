// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { AgentSystemPromptDraft } from '@shared/ipc/schemas/agent'

import { PiPromptField, type PiPromptDraft } from '../PiPromptField'

const request = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

// The renderer test locale is zh-CN.
const INSTRUCTIONS = { name: '智能体系统提示词' }
const LOAD_FAILED = '无法生成完整的系统提示词'
const baseDraft: PiPromptDraft = {
  skillIds: [],
  disabledTools: [],
  knowledgeBaseIds: [],
  mcpServerIds: [],
  languageMode: 'inherit',
  languageCustom: ''
}

/** Echoes the draft into the fixed segments so a test can see which draft a preview came from. */
function answerWithDraft() {
  request.mockImplementation(async (_route: string, input: AgentSystemPromptDraft) => ({
    before: `<skills>${input.skillIds.join(',')}</skills>\n<agent_instructions>\n`,
    after: `\n</agent_instructions>\nlanguage=${String(input.language)}`
  }))
}

function Harness({ draft = baseDraft, initial = '' }: { draft?: PiPromptDraft; initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <PiPromptField value={value} onChange={setValue} draft={draft} />
      <p>saved: {value}</p>
    </>
  )
}

beforeEach(() => {
  request.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('PiPromptField', () => {
  it('shows the assembled prompt around the instructions, which are the only editable part', async () => {
    answerWithDraft()
    render(<Harness initial="Review code." />)

    expect(await screen.findByText(/<skills><\/skills>/)).toBeInTheDocument()
    expect(screen.getByText(/language=undefined/)).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toEqual([screen.getByRole('textbox', INSTRUCTIONS)])
    expect(screen.getByRole('textbox', INSTRUCTIONS)).toHaveValue('Review code.')
  })

  it('sends edits to the form', async () => {
    answerWithDraft()
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('textbox', INSTRUCTIONS), 'Cite sources.')

    expect(screen.getByText('saved: Cite sources.')).toBeInTheDocument()
  })

  it('reassembles the prompt when skills or the reply language change', async () => {
    answerWithDraft()
    const { rerender } = render(<Harness />)
    expect(await screen.findByText(/<skills><\/skills>/)).toBeInTheDocument()

    rerender(<Harness draft={{ ...baseDraft, skillIds: ['release-notes'] }} />)
    expect(await screen.findByText(/<skills>release-notes<\/skills>/)).toBeInTheDocument()

    rerender(<Harness draft={{ ...baseDraft, skillIds: ['release-notes'], languageMode: 'off' }} />)
    expect(await screen.findByText(/language=null/)).toBeInTheDocument()

    rerender(
      <Harness
        draft={{ ...baseDraft, skillIds: ['release-notes'], languageMode: 'custom', languageCustom: 'English' }}
      />
    )
    expect(await screen.findByText(/language=English/)).toBeInTheDocument()
  })

  it('reports a failed assembly and recovers on retry, keeping the instructions editable', async () => {
    request.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(<Harness initial="Review code." />)

    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument()
    expect(screen.getByRole('textbox', INSTRUCTIONS)).toHaveValue('Review code.')

    answerWithDraft()
    await user.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(screen.getByText(/<skills><\/skills>/)).toBeInTheDocument())
    expect(screen.queryByText(LOAD_FAILED)).not.toBeInTheDocument()
  })
})
