import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copyText: vi.fn().mockResolvedValue(undefined),
  setCopiedTemporarily: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => `${key}:${params?.id ?? ''}` })
}))
vi.mock('../../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({
    copyText: mocks.copyText,
    notifyError: vi.fn()
  })
}))
vi.mock('@renderer/hooks/useTemporaryValue', () => ({
  useTemporaryValue: () => [false, mocks.setCopiedTemporarily]
}))
vi.mock('@renderer/components/icons/CopyIcon', () => ({
  default: () => <span data-testid="copy-icon" />
}))
vi.mock('../../shared/GenericTools', () => ({
  ToolHeader: ({ toolName, params }: { toolName: string; params?: React.ReactNode }) => (
    <div data-testid="tool-header">
      {toolName}
      <span data-testid="params">{params}</span>
    </div>
  ),
  SkeletonValue: ({ value }: { value?: React.ReactNode }) => <span data-testid="value">{value}</span>,
  useIsStreaming: () => false
}))
vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre data-testid="workflow-script">{value}</pre>
}))

import { WorkflowTool } from '../WorkflowTool'

// The renderer is a function using hooks — invoke it inside a component's render.
const Harness = ({
  showChildren = true,
  ...props
}: Parameters<typeof WorkflowTool>[0] & {
  showChildren?: boolean
}) => {
  const item = WorkflowTool(props)
  return (
    <>
      {item.label}
      {showChildren ? item.children : null}
    </>
  )
}

describe('WorkflowTool', () => {
  it('retains valid receipt fields when sibling display fields are malformed', () => {
    render(
      <Harness
        input={{ name: 'requested name' }}
        output={{
          workflowName: { name: 'invalid' },
          summary: 'Keep summary',
          warning: ['invalid warning'],
          error: { message: 'invalid error' },
          runId: 'run-1',
          scriptPath: '/tmp/review.js'
        }}
      />
    )

    expect(screen.getByTestId('params')).toHaveTextContent('requested name')
    expect(screen.getByText('Keep summary')).toBeInTheDocument()
    expect(screen.getByText('run-1')).toBeInTheDocument()
    expect(screen.getByText('/tmp/review.js')).toBeInTheDocument()
  })

  it('preserves an empty returned workflow name instead of replacing it with the input name', () => {
    render(<Harness input={{ name: 'requested name' }} output={{ workflowName: '', taskId: 'task-1' }} />)

    expect(screen.queryByText('requested name')).not.toBeInTheDocument()
    expect(screen.getByTestId('params').textContent).toBe('')
  })

  it('renders the generated JavaScript and launch metadata', async () => {
    render(
      <Harness
        input={{ script: 'export const meta = { name: "review" }' }}
        output={{
          status: 'async_launched',
          taskId: 't-5',
          taskType: 'local_workflow',
          workflowName: 'review',
          runId: 'run-1',
          scriptPath: '/tmp/review.js'
        }}
      />
    )

    expect(await screen.findByTestId('workflow-script')).toHaveTextContent('export const meta')
    expect(screen.getByText('run-1')).toBeInTheDocument()
    expect(screen.getByText('/tmp/review.js')).toBeInTheDocument()
  })

  it('copies the complete generated JavaScript', async () => {
    const user = userEvent.setup()
    const script = '\n  export const meta = { name: "review" }\n'
    render(<Harness input={{ script }} />)

    await screen.findByTestId('workflow-script')
    await user.click(screen.getByRole('button', { name: 'common.copy:' }))

    expect(mocks.copyText).toHaveBeenCalledWith(script, { successMessage: 'common.copied:' })
  })

  it('keeps the launch receipt readable when the streamed script is malformed', () => {
    render(
      <Harness
        input={{ name: 'requested name', script: { source: 'invalid script' } }}
        output={{
          status: 'async_launched',
          taskId: 't-5',
          taskType: 'local_workflow',
          workflowName: 'launched workflow',
          runId: 'run-1',
          scriptPath: '/tmp/review.js'
        }}
      />
    )

    expect(screen.getByText('launched workflow')).toBeInTheDocument()
    expect(screen.getByText('run-1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.copy:' })).not.toBeInTheDocument()
  })
})
