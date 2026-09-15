import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CodeBlockView } from '../CodeBlockView'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre aria-label="Code viewer">{value}</pre>
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({ useCmTheme: () => 'light' }))
vi.mock('@renderer/services/PyodideService', () => ({ pyodideService: {} }))

describe('LaTeX code block preview', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en-us')
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.editor.enabled': false,
      'chat.code.collapsible': false,
      'chat.code.wrappable': true,
      'chat.code.execution.enabled': false,
      'chat.message.font_size': 14
    })
  })

  // JSDOM cannot compute styles on MathML; query its semantic role without a visibility calculation.
  it('defaults to a formula and switches to the unchanged source and back', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    const source = String.raw`\frac{a}{b}`
    render(
      <CodeBlockView language="latex" editable={false}>
        {source}
      </CodeBlockView>
    )

    expect(await screen.findByRole('math', { hidden: true })).toHaveTextContent('ab')
    expect(screen.queryByLabelText('Code viewer')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download Source Code' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy Source Code' }))
    expect(writeText).toHaveBeenCalledWith(source)

    await user.click(screen.getByRole('button', { name: 'View Source Code' }))
    expect(screen.getByLabelText('Code viewer').textContent).toBe(source)
    expect(screen.queryByRole('math', { hidden: true })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByRole('math', { hidden: true })).toHaveTextContent('ab')
    expect(screen.queryByLabelText('Code viewer')).not.toBeInTheDocument()
  })

  it.each(['$$\\frac{a}{b}$$', '\\[\\frac{a}{b}\\]', '\\[\\frac{a}{\\[b\\]}\\]', '\\begin{aligned}a&=b\\end{aligned}'])(
    'previews mathematical LaTeX with existing delimiters or environments: %s',
    async (source) => {
      render(
        <CodeBlockView language="latex" editable={false}>
          {source}
        </CodeBlockView>
      )

      expect(await screen.findByRole('math', { hidden: true })).toHaveTextContent('a')
      expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('b')
    }
  )

  it('recovers from incomplete streamed LaTeX without overriding the selected source view', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <CodeBlockView language="latex" editable={false} isStreaming>
        {'\\frac{a}{'}
      </CodeBlockView>
    )
    expect(await screen.findByText('\\frac{a}{')).toBeInTheDocument()

    rerender(
      <CodeBlockView language="latex" editable={false} isStreaming>
        {'\\frac{a}{b}'}
      </CodeBlockView>
    )
    expect(await screen.findByRole('math', { hidden: true })).toHaveTextContent('ab')

    await user.click(screen.getByRole('button', { name: 'View Source Code' }))
    rerender(
      <CodeBlockView language="latex" editable={false}>
        {'\\frac{c}{d}'}
      </CodeBlockView>
    )
    expect(screen.getByLabelText('Code viewer').textContent).toBe('\\frac{c}{d}')
    expect(screen.queryByRole('math', { hidden: true })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('cd'))
  })
})
