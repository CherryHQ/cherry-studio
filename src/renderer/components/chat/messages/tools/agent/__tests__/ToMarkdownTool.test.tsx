import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => `${key}:${options?.count ?? ''}` })
}))
vi.mock('../../shared/ClickableFilePath', () => ({
  ClickableFilePath: ({ path, displayName }: { path: string; displayName?: string }) => (
    <span data-testid="file-path" data-path={path}>
      {displayName ?? path}
    </span>
  )
}))
vi.mock('../../shared/GenericTools', () => ({
  SkeletonValue: ({ value }: { value: ReactNode }) => <>{value}</>,
  ToolHeader: ({ params, stats }: { params?: ReactNode; stats?: ReactNode }) => (
    <div data-testid="tool-header">
      {params}
      <span data-testid="stats">{stats}</span>
    </div>
  )
}))

import { ToMarkdownTool } from '../ToMarkdownTool'

const receipt = (path: string, chars: number) => ({
  content: [{ type: 'text', text: JSON.stringify({ path, chars }) }]
})

const Harness = (props: { input?: unknown; output?: unknown }) => {
  const item = ToMarkdownTool(props)
  return (
    <>
      {item.label}
      {item.children}
    </>
  )
}

describe('ToMarkdownTool', () => {
  it('shows the source file by name and links the converted Markdown', () => {
    render(
      <Harness input={{ path: '/Users/me/Data/Files/019fd4ff.pptx' }} output={receipt('/tmp/to-markdown/a.md', 4210)} />
    )

    const paths = screen.getAllByTestId('file-path')
    // The source keeps its basename in the header; the receipt path is the expandable body.
    expect(paths[0]).toHaveAttribute('data-path', '/Users/me/Data/Files/019fd4ff.pptx')
    expect(paths[0]).toHaveTextContent('019fd4ff.pptx')
    expect(paths[1]).toHaveAttribute('data-path', '/tmp/to-markdown/a.md')
    expect(screen.getByTestId('stats')).toHaveTextContent('message.tools.units.char:4210')
  })

  it('renders no body and no stats when the conversion failed', () => {
    render(
      <Harness
        input={{ path: '/tmp/secret.pptx' }}
        output={{ content: [{ type: 'text', text: 'Error: File not found: /tmp/secret.pptx' }], isError: true }}
      />
    )

    expect(screen.getAllByTestId('file-path')).toHaveLength(1)
    expect(screen.getByTestId('stats')).toBeEmptyDOMElement()
  })

  it('survives a partial streaming input with no path yet', () => {
    render(<Harness input={{}} />)
    expect(screen.queryByTestId('file-path')).toBeNull()
  })
})
