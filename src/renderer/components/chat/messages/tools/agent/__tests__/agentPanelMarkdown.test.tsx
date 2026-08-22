/**
 * Agent tool panels render model output, so they must go through the shared
 * `<Markdown>` pipeline rather than a bare `<Streamdown>`: the stock pipeline
 * rewrites a link/image it will not load into a `[blocked]` placeholder,
 * defacing text the model actually returned.
 */

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => `${key}:${options?.count ?? ''}` })
}))
vi.mock('../../shared/ClickableFilePath', () => ({
  ClickableFilePath: ({ path }: { path: string }) => <span>{path}</span>
}))
vi.mock('../../shared/GenericTools', () => ({
  SkeletonValue: ({ value }: { value: ReactNode }) => <>{value}</>,
  ToolHeader: () => <div />,
  TruncatedIndicator: () => <div />
}))

import { ExitPlanModeTool } from '../ExitPlanModeTool'
import { NotebookEditTool } from '../NotebookEditTool'

const SANDBOX_LINK = '[Download deck](sandbox:/mnt/data/deck.pptx)'
const SANDBOX_IMAGE = '![Chart](sandbox:/c.png)'

describe('agent tool panels', () => {
  it('renders a plan containing an unlinkable download link without defacing it', () => {
    const { container } = render(<>{ExitPlanModeTool({ input: { plan: SANDBOX_LINK } }).children}</>)

    expect(container.textContent).toContain('Download deck')
    expect(container.innerHTML).not.toContain('blocked')
    expect(container.querySelector('a[href]')).toBeNull()
  })

  it('renders tool output containing an unloadable image without defacing it', () => {
    const { container } = render(<>{NotebookEditTool({ output: SANDBOX_IMAGE }).children}</>)

    expect(container.textContent).toContain('Chart')
    expect(container.innerHTML).not.toContain('blocked')
    expect(container.querySelector('img')).toBeNull()
  })
})
