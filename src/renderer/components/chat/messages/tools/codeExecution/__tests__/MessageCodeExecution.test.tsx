import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { chooseTool } from '../../chooseTool'
import { buildToolResponseFromPart } from '../../toolResponse'

describe('native code execution result presentation', () => {
  it('renders persisted provider-executed calls and available results after rebuilding from message parts', async () => {
    const response = buildToolResponseFromPart({
      type: 'dynamic-tool',
      toolCallId: 'code-1',
      toolName: 'codeExecution',
      state: 'output-available',
      providerExecuted: true,
      input: { code: 'print(2 + 2)' },
      output: { output: '4' }
    } as unknown as CherryMessagePart)
    expect(response?.tool.type).toBe('provider')
    render(chooseTool(response as NormalToolResponse))
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(await screen.findByText(/print\(2 \+ 2\)/)).toBeInTheDocument()
    expect(screen.getByText(/"output": "4"/)).toBeInTheDocument()
  })
})
