import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => `${key}:${params?.id ?? ''}` })
}))
vi.mock('../../shared/GenericTools', () => ({
  ToolHeader: ({ toolName, params }: { toolName: string; params?: React.ReactNode }) => (
    <div data-testid="tool-header">
      {toolName}
      <span data-testid="params">{params}</span>
    </div>
  ),
  SkeletonValue: ({ value }: { value?: React.ReactNode }) => <span data-testid="value">{value}</span>
}))

import { WorkflowTool } from '../WorkflowTool'

// The renderer is a function using hooks — invoke it inside a component's render.
const Harness = (props: Parameters<typeof WorkflowTool>[0]) => {
  const item = WorkflowTool(props)
  return (
    <>
      {item.label}
      {item.children}
    </>
  )
}

describe('WorkflowTool', () => {
  it('labels the run with workflowName from the launch receipt', () => {
    render(
      <Harness
        input={{ script: 'export const meta = {}' }}
        output={{ status: 'async_launched', taskId: 't-1', workflowName: 'find-flaky-tests' }}
      />
    )

    expect(screen.getByTestId('value')).toHaveTextContent('find-flaky-tests')
  })

  it('falls back to the input name when the receipt carries no workflowName', () => {
    render(<Harness input={{ name: 'review-changes' }} output={{ status: 'async_launched', taskId: 't-2' }} />)

    expect(screen.getByTestId('value')).toHaveTextContent('review-changes')
  })

  it('falls back to the task id when neither name is present', () => {
    // An inline script carries its name in the script's meta block, so a pre-result render has none.
    render(
      <Harness input={{ script: 'export const meta = {}' }} output={{ status: 'async_launched', taskId: 't-3' }} />
    )

    expect(screen.getByTestId('value')).toHaveTextContent('t-3')
  })

  it('ignores input.description, which the SDK documents as ignored', () => {
    render(<Harness input={{ description: 'should not be shown', script: 'x' }} />)

    expect(screen.getByTestId('value')).not.toHaveTextContent('should not be shown')
  })

  it('renders the summary as disclosure children when present', () => {
    render(
      <Harness input={{ name: 'w' }} output={{ status: 'async_launched', taskId: 't-4', summary: 'Ran 5 agents' }} />
    )

    expect(screen.getByText('Ran 5 agents')).toBeInTheDocument()
  })

  it('treats a plain string result as having no receipt', () => {
    render(<Harness input={{ name: 'w' }} output="Workflow launched in background." />)

    expect(screen.getByTestId('value')).toHaveTextContent('w')
  })
})
