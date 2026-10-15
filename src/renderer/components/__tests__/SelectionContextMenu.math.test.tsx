import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import katex from 'katex'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { formatQuoteTokenPromptText } from '@renderer/components/composer/quoteToken'
import { AppMarkdown } from '@renderer/components/markdown'
import { CommandSharedPreferencesContext } from '@renderer/hooks/command'

import SelectionContextMenu from '../SelectionContextMenu'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function renderSelection(markup: string) {
  return render(
    <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
      <SelectionContextMenu>
        <div data-testid="message" dangerouslySetInnerHTML={{ __html: markup }} />
      </SelectionContextMenu>
    </CommandSharedPreferencesContext>
  )
}

function selectContents(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  window.getSelection()?.addRange(range)
}

describe('quoting selected math', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.message.math.single_dollar', true)
    window.getSelection()?.removeAllRanges()
    window.api.quoteToMainWindow = vi.fn().mockResolvedValue(undefined)
  })

  it.each([
    { displayMode: false, singleDollar: true, source: 'E=mc^2', quoted: '$E=mc^2$' },
    { displayMode: false, singleDollar: false, source: 'E=mc^2', quoted: '\\(E=mc^2\\)' },
    { displayMode: false, singleDollar: true, source: String.raw`\text{\$5}`, quoted: String.raw`\(\text{\$5}\)` },
    {
      displayMode: true,
      singleDollar: true,
      source: String.raw`i\hbar \frac{\partial}{\partial t} \Psi = \hat{H} \Psi`,
      quoted: '\n$$\ni\\hbar \\frac{\\partial}{\\partial t} \\Psi = \\hat{H} \\Psi\n$$\n'
    },
    {
      displayMode: true,
      singleDollar: true,
      source: '\\begin{aligned}\nx&=1\\\\\ny&=2\n\\end{aligned}',
      quoted: '\n$$\n\\begin{aligned}\nx&=1\\\\\ny&=2\n\\end{aligned}\n$$\n'
    }
  ])(
    'quotes and re-renders $source with single-dollar math $singleDollar',
    async ({ displayMode, singleDollar, source, quoted }) => {
      const user = userEvent.setup()
      MockUsePreferenceUtils.setPreferenceValue('chat.message.math.single_dollar', singleDollar)
      const view = renderSelection(katex.renderToString(source, { displayMode }))
      const message = screen.getByTestId('message')
      selectContents(message.querySelector('.katex-html .mord')!)

      fireEvent.contextMenu(message)
      window.getSelection()?.removeAllRanges()
      await user.click(await screen.findByRole('menuitem', { name: 'chat.message.quote' }))

      await waitFor(() => expect(window.api.quoteToMainWindow).toHaveBeenCalledWith(quoted))
      const quotedText = vi.mocked(window.api.quoteToMainWindow).mock.calls[0][0]
      view.unmount()
      const result = render(
        <AppMarkdown singleDollarMath={singleDollar}>{formatQuoteTokenPromptText(quotedText)}</AppMarkdown>
      )

      expect(result.container.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(source)
      expect(result.container.querySelector('math')?.getAttribute('display')).toBe(displayMode ? 'block' : null)
      expect(result.container.querySelector('.katex-error')).toBeNull()
    }
  )

  it('keeps adjacent inline formulas separate across formatting wrappers', async () => {
    const user = userEvent.setup()
    const view = renderSelection(
      `<em>${katex.renderToString('a')}</em><strong>${katex.renderToString('b')}</strong>${katex.renderToString('c')}`
    )
    const message = screen.getByTestId('message')
    selectContents(message)

    fireEvent.contextMenu(message)
    await user.click(await screen.findByRole('menuitem', { name: 'chat.message.quote' }))

    await waitFor(() => expect(window.api.quoteToMainWindow).toHaveBeenCalledWith('$a$\\(b\\)$c$'))
    const quotedText = vi.mocked(window.api.quoteToMainWindow).mock.calls[0][0]
    view.unmount()
    const result = render(<AppMarkdown>{formatQuoteTokenPromptText(quotedText)}</AppMarkdown>)

    expect(
      Array.from(result.container.querySelectorAll('annotation[encoding="application/x-tex"]'), (el) => el.textContent)
    ).toEqual(['a', 'b', 'c'])
    expect(result.container.querySelector('.katex-error')).toBeNull()
  })

  it.each([
    { before: 'It costs $5 for ', after: ' items.' },
    { before: 'For ', after: ' items, it costs $5.' }
  ])('preserves currency prose around a quoted formula: $before n $after', async ({ before, after }) => {
    const user = userEvent.setup()
    const view = renderSelection(`${before}<em>${katex.renderToString('n')}</em>${after}`)
    const message = screen.getByTestId('message')
    selectContents(message)

    fireEvent.contextMenu(message)
    await user.click(await screen.findByRole('menuitem', { name: 'chat.message.quote' }))

    await waitFor(() => expect(window.api.quoteToMainWindow).toHaveBeenCalled())
    const quotedText = vi.mocked(window.api.quoteToMainWindow).mock.calls[0][0]
    view.unmount()
    const result = render(<AppMarkdown>{formatQuoteTokenPromptText(quotedText)}</AppMarkdown>)

    expect(
      Array.from(result.container.querySelectorAll('annotation[encoding="application/x-tex"]'), (el) => el.textContent)
    ).toEqual(['n'])
    result.container.querySelectorAll('.katex').forEach((formula) => formula.remove())
    expect(result.container).toHaveTextContent(`${before}${after}`.replace(/\s+/g, ' '))
  })

  it('preserves prose and mixed math when quoting a selected link', async () => {
    const user = userEvent.setup()
    const view = renderSelection(
      `<a href="https://example.com">Hello ${katex.renderToString('E=mc^2')} world` +
        `${katex.renderToString('x=1', { displayMode: true })}after</a>`
    )
    const link = screen.getByRole('link')
    selectContents(link)

    fireEvent.contextMenu(link)
    await user.click(await screen.findByRole('menuitem', { name: 'chat.message.quote' }))

    await waitFor(() =>
      expect(window.api.quoteToMainWindow).toHaveBeenCalledWith('Hello $E=mc^2$ world\n$$\nx=1\n$$\nafter')
    )
    const quotedText = vi.mocked(window.api.quoteToMainWindow).mock.calls[0][0]
    view.unmount()
    const result = render(<AppMarkdown>{formatQuoteTokenPromptText(quotedText)}</AppMarkdown>)

    expect(
      Array.from(result.container.querySelectorAll('annotation[encoding="application/x-tex"]'), (el) => el.textContent)
    ).toEqual(['E=mc^2', 'x=1'])
    expect(result.getByText(/Hello/)).toHaveTextContent('world')
    expect(result.getByText('after')).toBeVisible()
  })
})
