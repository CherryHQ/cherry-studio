import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, StrictMode, useLayoutEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import {
  getCachedMessageUiState,
  invalidateCachedMessageUiStates,
  updateCachedMessageUiState
} from '@renderer/services/messageUiStateCache'

import { MessagePartsScopeProvider } from '../../blocks/MessagePartsContext'
import ChatMarkdown from '../ChatMarkdownRuntime'

const mocks = vi.hoisted(() => ({
  actions: undefined as
    | undefined
    | {
        openArtifactFile?: (path: string) => void | Promise<void>
        openPath?: (path: string) => void | Promise<void>
        isDirectory?: (path: string) => Promise<boolean>
      }
}))

vi.unmock('@data/CacheService')

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false }),
  useOptionalMessageListActions: () => mocks.actions
}))
vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

describe('ChatMarkdown adapter', () => {
  beforeEach(() => {
    mocks.actions = undefined
  })

  it('keeps the paused message placeholder in the chat adapter', () => {
    render(<ChatMarkdown block={{ id: 'part', content: '', status: 'paused' }} />)
    expect(screen.getByText('message.chat.completion.paused')).toBeVisible()
  })

  it('preserves code source while processing prose around HTML artifacts', () => {
    const source = 'Outside\n\n```html\n<script>const text = "Outside"</script>\n```'
    render(
      <ChatMarkdown
        block={{ id: 'part', content: source, status: 'success' }}
        inlineHtmlPreviewMode="ready"
        postProcess={(content) => content.replaceAll('Outside', 'Processed')}
        components={{ code: ({ children }) => <code>{children}</code> }}
      />,
      { wrapper: CodeStyleProvider }
    )
    expect(screen.getByText('Processed')).toBeVisible()
    expect(screen.getByText('<script>const text = "Outside"</script>')).toBeVisible()
  })

  it('routes directory links through the workspace-aware opener', async () => {
    const user = userEvent.setup()
    const openPath = vi.fn()
    const openArtifactFile = vi.fn()
    mocks.actions = { openPath, openArtifactFile, isDirectory: vi.fn().mockResolvedValue(true) }
    render(<ChatMarkdown block={{ id: 'part', content: '[Docs](./docs)', status: 'success' }} />)
    await user.click(screen.getByRole('link', { name: 'Docs' }))
    expect(openPath).toHaveBeenCalledWith('./docs')
    expect(openArtifactFile).not.toHaveBeenCalled()
  })
})

function stream(source: string, owner = 'animation-owner', status: 'streaming' | 'success' = 'streaming') {
  return (
    <MessagePartsScopeProvider parts={[]} messageId={owner}>
      <ChatMarkdown block={{ id: 'part', content: source, status }} />
    </MessagePartsScopeProvider>
  )
}
function retryUiState(id: string) {
  updateCachedMessageUiState(id, (current) => ({
    ...current,
    markdownEpoch: (current.markdownEpoch ?? 0) + 1,
    markdownSources: undefined,
    thinkingScroll: undefined,
    disclosures: undefined
  }))
}
function durations(container: HTMLElement, expected: Record<string, string>) {
  const spans = [...container.querySelectorAll<HTMLElement>('span[data-sd-animate]')]
  for (const [word, duration] of Object.entries(expected)) {
    const matches = spans.filter((span) => span.textContent?.trim() === word)
    expect(matches.length, word).toBeGreaterThan(0)
    for (const span of matches) expect(span.style.getPropertyValue('--sd-duration'), word).toBe(duration)
  }
}
describe('message animation continuity', () => {
  beforeEach(() => {
    cleanup()
    invalidateCachedMessageUiStates(['animation-owner', 'other-owner'])
  })
  it('restores the same source across remounts and isolates another message', () => {
    const first = render(stream('Alpha beta\n\nGamma'))
    durations(first.container, { Alpha: '250ms', beta: '250ms', Gamma: '250ms' })
    first.unmount()
    const second = render(stream('Alpha beta\n\nGamma'))
    durations(second.container, { Alpha: '0ms', beta: '0ms', Gamma: '0ms' })
    second.unmount()
    const other = render(stream('Alpha beta\n\nGamma', 'other-owner'))
    durations(other.container, { Alpha: '250ms', Gamma: '250ms' })
  })
  it('preserves the code wrapping choice after a same-source remount and another UI cache write', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.wrappable': true,
      'chat.code.editor.enabled': false
    })
    const source = '```javascript\nconst value = 1\n```'
    const first = render(stream(source), { wrapper: CodeStyleProvider })
    first.unmount()
    render(stream(source), { wrapper: CodeStyleProvider })
    await user.click(screen.getByRole('button', { name: 'code_block.wrap.off' }))
    expect(screen.getByRole('button', { name: 'code_block.wrap.on' })).toBeVisible()

    act(() =>
      updateCachedMessageUiState('animation-owner', (current) => ({
        ...current,
        disclosures: { ...current.disclosures, 'thinking:another-part': true }
      }))
    )

    expect(screen.getByRole('button', { name: 'code_block.wrap.on' })).toBeVisible()
  })
  it('preserves SVG source view across another tab’s streaming update', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({ 'chat.code.editor.enabled': false })
    const source = '```svg\n<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>\n```'
    const nextSource = source + '\n\nAnother chunk'
    const first = render(<Activity mode="visible">{stream(source)}</Activity>, { wrapper: CodeStyleProvider })
    const second = render(<Activity mode="hidden">{stream(source)}</Activity>, { wrapper: CodeStyleProvider })
    await user.click(within(first.container).getByRole('button', { name: 'preview.source' }))
    expect(within(first.container).getByRole('button', { name: 'preview.label' })).toBeVisible()
    const sourceText = within(first.container).getByText(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>'
    )
    expect(sourceText).toBeVisible()

    first.rerender(<Activity mode="hidden">{stream(source)}</Activity>)
    second.rerender(<Activity mode="visible">{stream(source)}</Activity>)
    second.rerender(<Activity mode="visible">{stream(nextSource)}</Activity>)
    expect(within(second.container).getByText('Another')).toBeVisible()
    second.rerender(<Activity mode="hidden">{stream(nextSource)}</Activity>)
    first.rerender(<Activity mode="visible">{stream(nextSource)}</Activity>)

    expect(within(first.container).getByRole('button', { name: 'preview.label' })).toBeVisible()
    expect(
      within(first.container).getByText('<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>')
    ).toBe(sourceText)
    expect(sourceText).toBeVisible()
  })
  it('preserves SVG source view when another Activity completes streaming', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({ 'chat.code.editor.enabled': false })
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>'
    const source = '```svg\n' + svg + '\n```'
    const first = render(<Activity mode="visible">{stream(source)}</Activity>, { wrapper: CodeStyleProvider })
    const second = render(<Activity mode="hidden">{stream(source)}</Activity>, { wrapper: CodeStyleProvider })
    await user.click(within(first.container).getByRole('button', { name: 'preview.source' }))
    const sourceText = within(first.container).getByText(svg)
    expect(sourceText).toBeVisible()

    first.rerender(<Activity mode="hidden">{stream(source)}</Activity>)
    second.rerender(<Activity mode="visible">{stream(source)}</Activity>)
    second.rerender(<Activity mode="visible">{stream(source, 'animation-owner', 'success')}</Activity>)
    expect(getCachedMessageUiState('animation-owner').markdownSources?.part).toBeUndefined()
    second.rerender(<Activity mode="hidden">{stream(source, 'animation-owner', 'success')}</Activity>)
    first.rerender(<Activity mode="visible">{stream(source, 'animation-owner', 'success')}</Activity>)

    expect(within(first.container).getByRole('button', { name: 'preview.label' })).toBeVisible()
    expect(within(first.container).getByText(svg)).toBe(sourceText)
    expect(sourceText).toBeVisible()
  })
  it('preserves SVG source view and wrapping when two visible views complete together', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.wrappable': true,
      'chat.code.editor.enabled': false
    })
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>'
    const source = '```svg\n' + svg + '\n```\n\n```javascript\nconst value = 1\n```'
    const first = render(<Activity mode="visible">{stream(source)}</Activity>, { wrapper: CodeStyleProvider })
    const second = render(<Activity mode="visible">{stream(source)}</Activity>, { wrapper: CodeStyleProvider })
    const sourceNodes: HTMLElement[] = []
    for (const view of [first, second]) {
      await user.click(within(view.container).getByRole('button', { name: 'preview.source' }))
      await user.click(within(view.container).getByRole('button', { name: 'code_block.wrap.off' }))
      const sourceText = within(view.container).getByText(svg)
      expect(sourceText).toBeVisible()
      sourceNodes.push(sourceText)
    }

    act(() => {
      first.rerender(<Activity mode="visible">{stream(source, 'animation-owner', 'success')}</Activity>)
      second.rerender(<Activity mode="visible">{stream(source, 'animation-owner', 'success')}</Activity>)
    })
    expect(getCachedMessageUiState('animation-owner').markdownSources?.part).toBeUndefined()

    for (const [index, view] of [first, second].entries()) {
      expect(within(view.container).getByRole('button', { name: 'preview.label' })).toBeVisible()
      expect(within(view.container).getByRole('button', { name: 'code_block.wrap.on' })).toBeVisible()
      expect(within(view.container).getByText(svg)).toBe(sourceNodes[index])
      expect(sourceNodes[index]).toBeVisible()
    }
  })
  it('restores all words and blocks received while away, then animates only subsequent arrivals', () => {
    const first = render(stream('Alpha'))
    first.unmount()
    const second = render(stream('Alpha beta\n\nGamma delta epsilon'))
    durations(second.container, { Alpha: '0ms', beta: '0ms', Gamma: '0ms', epsilon: '0ms' })
    second.rerender(stream('Alpha beta\n\nGamma delta epsilon zeta\n\nNew'))
    durations(second.container, { Alpha: '0ms', Gamma: '0ms', zeta: '250ms', New: '250ms' })
  })
  it('keeps long and short block waterlines separate', () => {
    const view = render(stream('Alpha beta gamma delta\n\nShort'))
    view.rerender(stream('Alpha beta gamma delta\n\nShort extra'))
    durations(view.container, { extra: '250ms' })
    view.rerender(stream('Alpha beta gamma delta\n\nShort extra more'))
    durations(view.container, { Short: '0ms', extra: '0ms', more: '250ms' })
  })
  it('does not recover an empty cached source', () => {
    updateCachedMessageUiState('animation-owner', { markdownSources: { part: { source: '' } } })
    const view = render(stream('Alpha'))
    durations(view.container, { Alpha: '250ms' })
  })
  it('rejects a changed prefix and another part under the same owner', () => {
    const first = render(stream('Alpha'))
    first.unmount()
    const second = render(stream('Replacement'))
    durations(second.container, { Replacement: '250ms' })
    second.unmount()
    const third = render(
      <MessagePartsScopeProvider messageId="animation-owner" parts={[]}>
        <ChatMarkdown block={{ id: 'another-part', content: 'Replacement', status: 'streaming' }} />
      </MessagePartsScopeProvider>
    )
    durations(third.container, { Replacement: '250ms' })
  })
  it('does not retain streaming recovery after completion', () => {
    const first = render(stream('Alpha'))
    first.rerender(
      <MessagePartsScopeProvider messageId="animation-owner" parts={[]}>
        <ChatMarkdown block={{ id: 'part', content: 'Alpha', status: 'success' }} />
      </MessagePartsScopeProvider>
    )
    first.unmount()
    const second = render(stream('Alpha'))
    durations(second.container, { Alpha: '250ms' })
  })
  it('retry revokes a mounted recovery phase before old commits can restore it', () => {
    const first = render(stream('Alpha'))
    first.unmount()
    const view = render(stream('Alpha'))
    durations(view.container, { Alpha: '0ms' })
    act(() => retryUiState('animation-owner'))
    durations(view.container, { Alpha: '250ms' })
    view.rerender(stream('Alpha beta'))
    durations(view.container, { Alpha: '0ms', beta: '250ms' })
  })
  it('revokes a source commit already pending when retry clears the cache', () => {
    const first = render(stream('Alpha'))
    first.unmount()
    const view = render(stream('Alpha'))
    let invalidate = true
    function RetryOnCommit({ children }: React.ComponentProps<'p'> | Record<string, unknown>) {
      useLayoutEffect(() => {
        if (!invalidate) return
        invalidate = false
        retryUiState('animation-owner')
      }, [])
      return <p>{children as React.ReactNode}</p>
    }
    view.rerender(
      <MessagePartsScopeProvider messageId="animation-owner" parts={[]}>
        <ChatMarkdown
          block={{ id: 'part', content: 'Alpha beta', status: 'streaming' }}
          components={{ p: RetryOnCommit }}
        />
      </MessagePartsScopeProvider>
    )
    durations(view.container, { Alpha: '250ms', beta: '250ms' })
  })
  it('Activity hiding preserves the mounted document and animates later arrivals', () => {
    const view = render(<Activity mode="visible">{stream('Alpha')}</Activity>)
    view.rerender(<Activity mode="hidden">{stream('Alpha')}</Activity>)
    view.rerender(<Activity mode="visible">{stream('Alpha beta')}</Activity>)
    durations(view.container, { Alpha: '0ms', beta: '250ms' })
  })
  it('retry while Activity is hidden revokes the retained recovery phase on reveal', () => {
    const view = render(<Activity mode="visible">{stream('Alpha')}</Activity>)
    view.rerender(<Activity mode="hidden">{stream('Alpha')}</Activity>)
    act(() => retryUiState('animation-owner'))
    view.rerender(<Activity mode="visible">{stream('Alpha')}</Activity>)
    durations(view.container, { Alpha: '250ms' })
  })
  it('StrictMode reparses retain old words and animate new words in every block', () => {
    const view = render(<StrictMode>{stream('Alpha beta\n\nShort')}</StrictMode>)
    view.rerender(<StrictMode>{stream('Alpha beta gamma\n\nShort extra')}</StrictMode>)
    durations(view.container, { Alpha: '0ms', beta: '0ms', gamma: '250ms', Short: '0ms', extra: '250ms' })
  })
})

it('restores LaTeX-aware blocks before animating the next prose block', () => {
  const source = String.raw`Before

\[
a +

b
\]

After`
  const first = render(stream(source, 'latex-owner'))
  first.unmount()
  const second = render(stream(source, 'latex-owner'))
  durations(second.container, { Before: '0ms', After: '0ms' })
  expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('a+b')
  second.rerender(stream(source + '\n\nLater', 'latex-owner'))
  durations(second.container, { Later: '250ms' })
  second.unmount()
  invalidateCachedMessageUiStates(['latex-owner'])
})
