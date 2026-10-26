import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Root } from 'hast'
import type { Components } from 'streamdown'
import { unified } from 'unified'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import {
  StreamingAnimationService,
  streamingAnimationService,
  MarkdownAnimationSession
} from '@cherrystudio/ui/components/composites/markdown/streaming-animation-service'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { invalidateCachedMessageMarkdownStates } from '@renderer/services/messageUiStateCache'
import { thinkingScrollService } from '@renderer/services/ThinkingScrollService'

import { AppMarkdown } from '../AppMarkdown'
import { MarkdownHostProvider } from '../MarkdownHostProvider'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

const components: Partial<Components> = {
  code: ({ children }) => <textarea aria-label="Code draft" defaultValue={String(children)} />
}

describe('AppMarkdown', () => {
  it('preserves a code draft when streaming finishes and resets it for another document', async () => {
    const user = userEvent.setup()
    const source = '```text\noriginal\n```'
    const view = render(
      <AppMarkdown id="first" isStreaming components={components}>
        {source}
      </AppMarkdown>
    )
    const draft = screen.getByRole('textbox', { name: 'Code draft' })
    await user.clear(draft)
    await user.type(draft, 'unsaved draft')

    view.rerender(
      <AppMarkdown id="first" components={components}>
        {source}
      </AppMarkdown>
    )
    expect(screen.getByRole('textbox', { name: 'Code draft' })).toHaveValue('unsaved draft')

    view.rerender(
      <AppMarkdown id="second" components={components}>
        {source}
      </AppMarkdown>
    )
    expect(screen.getByRole('textbox', { name: 'Code draft' })).toHaveValue('original\n')
  })

  it('repairs the same bold URL in static and streaming content', () => {
    const source = '**https://example.com/page**（说明）'
    const view = render(<AppMarkdown id="static">{source}</AppMarkdown>)
    expect(screen.getByRole('link', { name: 'https://example.com/page' })).toHaveAttribute(
      'href',
      'https://example.com/page'
    )
    view.rerender(
      <AppMarkdown id="stream" isStreaming>
        {source}
      </AppMarkdown>
    )
    expect(screen.getByRole('link', { name: 'https://example.com/page' })).toHaveAttribute(
      'href',
      'https://example.com/page'
    )
  })

  it('keeps a bracket formula with a blank line intact across streaming updates', () => {
    const view = render(
      <AppMarkdown id="math" isStreaming>{String.raw`Before

\[
a +

`}</AppMarkdown>
    )
    view.rerender(
      <AppMarkdown id="math" isStreaming>{String.raw`Before

\[
a +

b
\]

After`}</AppMarkdown>
    )
    expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('a+b')
    expect(screen.getByText('After')).toBeVisible()
  })

  it('renders code controls without granting execution or editing', async () => {
    render(<AppMarkdown>{'```python\nprint(1)\n```'}</AppMarkdown>, { wrapper: CodeStyleProvider })
    expect(await screen.findByRole('button', { name: 'code_block.copy.source' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'code_block.run' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code_block.edit.label' })).not.toBeInTheDocument()
  })

  it('keeps chat-style relative images on the default pipeline without an image resolver', () => {
    const { container } = render(
      <MarkdownHostProvider openFilePath={vi.fn()}>
        <AppMarkdown>{'![](images/diagram.png)\n\n![diagram](images/diagram.png)\n\n![icon](./icon.svg)'}</AppMarkdown>
      </MarkdownHostProvider>
    )
    expect(screen.getByText('diagram')).toBeVisible()
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'icon' })).toHaveAttribute('src', '/icon.svg')
  })

  it('opens relative links only through an explicitly supplied host', async () => {
    const user = userEvent.setup()
    const openFilePath = vi.fn()
    render(
      <MarkdownHostProvider openFilePath={openFilePath}>
        <AppMarkdown>{'[Guide](./guide.md)'}</AppMarkdown>
      </MarkdownHostProvider>
    )
    await user.click(screen.getByRole('link', { name: 'Guide' }))
    expect(openFilePath).toHaveBeenCalledWith('./guide.md')
  })
})

beforeEach(() => {
  cleanup()
  streamingAnimationService.clear()
  thinkingScrollService.clear()
})
afterEach(() => {
  cleanup()
  streamingAnimationService.clear()
  thinkingScrollService.clear()
})

// Nonempty real animation spans protect visibility and the existing fadeIn/250ms contract.
function expectDurations(container: HTMLElement, expected: Record<string, string>) {
  const spans = [...container.querySelectorAll<HTMLSpanElement>('span[data-sd-animate]')]
  expect(spans.length).toBeGreaterThan(0)
  for (const [word, duration] of Object.entries(expected)) {
    const matches = spans.filter((span) => span.textContent?.trim() === word)
    expect(matches.length, word).toBeGreaterThan(0)
    for (const span of matches) {
      expect(span.style.getPropertyValue('--sd-duration'), word).toBe(duration)
      expect(span.style.getPropertyValue('--sd-animation')).toBe('sd-fadeIn')
    }
  }
}

function mountStream(id: string, source: string) {
  return render(
    <AppMarkdown id={id} isStreaming>
      {source}
    </AppMarkdown>
  )
}

describe('streaming animation recovery', () => {
  it('animates a new document and restores every block across two further mounts', () => {
    const id = 'recovery-multiple-blocks'
    const source = 'Alpha beta\n\nGamma delta'
    const first = mountStream(id, source)
    expectDurations(first.container, { Alpha: '250ms', beta: '250ms', Gamma: '250ms', delta: '250ms' })
    first.unmount()
    const second = mountStream(id, source)
    expectDurations(second.container, { Alpha: '0ms', beta: '0ms', Gamma: '0ms', delta: '0ms' })
    second.unmount()
    const third = mountStream(id, source)
    expectDurations(third.container, { Alpha: '0ms', beta: '0ms', Gamma: '0ms', delta: '0ms' })
  })

  it('animates only appended words after recovery', () => {
    const id = 'recovery-append'
    mountStream(id, 'Alpha beta').unmount()
    const view = mountStream(id, 'Alpha beta')
    view.rerender(
      <AppMarkdown id={id} isStreaming>
        Alpha beta epsilon
      </AppMarkdown>
    )
    expectDurations(view.container, { Alpha: '0ms', beta: '0ms', epsilon: '250ms' })
  })

  it('restores words received in the same block while unmounted and animates only later additions', () => {
    const id = 'recovery-same-block-away-growth'
    const words = Array.from({ length: 12 }, (_, index) => `reasoningword${index + 1}`)
    const first = mountStream(id, words[0])
    for (let count = 2; count <= words.length; count++) {
      first.rerender(
        <AppMarkdown id={id} isStreaming>
          {words.slice(0, count).join(' ')}
        </AppMarkdown>
      )
    }
    first.unmount()

    const snapshotWords = [...words, 'upsilon', 'phi', 'chi', 'psi', 'omega']
    const source = snapshotWords.join(' ')
    const view = mountStream(id, source)
    const restoredDurations = Object.fromEntries(snapshotWords.map((word) => [word, '0ms']))
    expect(view.container.querySelectorAll('span[data-sd-animate]')).toHaveLength(snapshotWords.length)
    expectDurations(view.container, restoredDurations)

    view.rerender(
      <AppMarkdown id={id} isStreaming>
        {source + ' afterreturn'}
      </AppMarkdown>
    )
    expectDurations(view.container, { ...restoredDurations, afterreturn: '250ms' })
  })

  it('animates newly appended blocks after recovery', () => {
    const id = 'recovery-new-block'
    mountStream(id, 'Alpha beta').unmount()
    const view = mountStream(id, 'Alpha beta')
    view.rerender(
      <AppMarkdown id={id} isStreaming>
        {'Alpha beta\n\nGamma delta'}
      </AppMarkdown>
    )
    expectDurations(view.container, { Alpha: '0ms', beta: '0ms', Gamma: '250ms', delta: '250ms' })
  })

  it('keeps committed animation boundaries isolated between differently sized blocks', () => {
    const id = 'recovery-block-boundaries'
    const source = 'Alpha beta gamma delta epsilon zeta\n\nEta theta'
    mountStream(id, source).unmount()
    const view = mountStream(id, source)
    view.rerender(
      <AppMarkdown id={id} isStreaming>
        {source + ' iota'}
      </AppMarkdown>
    )
    expectDurations(view.container, {
      Alpha: '0ms',
      beta: '0ms',
      gamma: '0ms',
      delta: '0ms',
      epsilon: '0ms',
      zeta: '0ms',
      Eta: '0ms',
      theta: '0ms',
      iota: '250ms'
    })
  })

  it('makes content received while away immediately visible, including additional blocks', () => {
    const id = 'recovery-away-growth'
    mountStream(id, 'Alpha beta').unmount()
    const view = mountStream(id, 'Alpha beta gamma\n\nDelta epsilon')
    expectDurations(view.container, { Alpha: '0ms', beta: '0ms', gamma: '0ms', Delta: '0ms', epsilon: '0ms' })
  })

  it('isolates identical content under different ids', () => {
    mountStream('recovery-identity-a', 'Alpha beta').unmount()
    const view = mountStream('recovery-identity-b', 'Alpha beta')
    expectDurations(view.container, { Alpha: '250ms', beta: '250ms' })
  })

  it('starts a new generation after message invalidation without clearing other messages', () => {
    mountStream('retry-message-part-0', 'Alpha beta').unmount()
    mountStream('other-message-part-0', 'Alpha beta').unmount()
    thinkingScrollService.write('retry-message-part-1', { scrollTop: 25, following: false, isExpanded: true })
    invalidateCachedMessageMarkdownStates(['retry-message'])
    expect(thinkingScrollService.read('retry-message-part-1')).toBeUndefined()
    const view = mountStream('retry-message-part-0', 'Alpha beta')
    expectDurations(view.container, { Alpha: '250ms', beta: '250ms' })
    view.unmount()
    expectDurations(mountStream('other-message-part-0', 'Alpha beta').container, { Alpha: '0ms', beta: '0ms' })
  })

  it('clears animation state when a completed stream returns through the static branch', () => {
    const id = 'recovery-completed'
    mountStream(id, 'Alpha beta').unmount()
    const view = render(<AppMarkdown id={id}>Alpha beta</AppMarkdown>)
    expect(streamingAnimationService.read(id)).toBeUndefined()
    view.unmount()
    expectDurations(mountStream(id, 'Alpha beta').container, { Alpha: '250ms', beta: '250ms' })
  })

  it('starts a new generation for replacement source', () => {
    const id = 'recovery-replacement'
    mountStream(id, 'Alpha beta').unmount()
    const view = mountStream(id, 'Gamma delta')
    expectDurations(view.container, { Gamma: '250ms', delta: '250ms' })
  })

  it('evicts whole documents by read recency and counts replacement block budgets once', () => {
    const service = new StreamingAnimationService({ maxDocuments: 2, maxBlocks: 3 })
    const snapshot = (count: number) => ({
      source: 'Alpha beta',
      optionsKey: 'default',
      blocks: new Map(Array.from({ length: count }, (_, i) => [i, 10]))
    })
    service.write('A', snapshot(1))
    service.write('B', snapshot(1))
    service.read('A')
    service.write('C', snapshot(1))
    expect(service.read('B')).toBeUndefined()
    expect(service.read('A')?.blocks.size).toBe(1)
    service.write('A', snapshot(2))
    service.write('A', snapshot(2))
    expect(service.read('C')?.blocks.size).toBe(1)
    service.write('D', snapshot(2))
    expect(service.read('A')).toBeUndefined()
    expect(service.read('D')?.blocks.size).toBe(2)
    service.write('D', snapshot(4))
    expect(service.read('D')).toBeUndefined()
    const blockLimited = new StreamingAnimationService({ maxDocuments: 10, maxBlocks: 3 })
    blockLimited.write('A', snapshot(2))
    blockLimited.write('B', snapshot(2))
    expect(blockLimited.read('A')).toBeUndefined()
    expect(blockLimited.read('B')?.blocks.size).toBe(2)
  })

  it('keeps the restore boundary across repeated getters and real parses until commit', () => {
    const id = 'pending-restore'
    streamingAnimationService.write(id, { source: 'Alpha beta', optionsKey: '{}', blocks: new Map([[0, 10]]) })
    const session = new MarkdownAnimationSession(id, 'Alpha beta gamma', '{}', {})
    session.captureInitialBlocks(['Alpha beta gamma'])
    session.captureInitialBlocks(['Alpha beta gamma', 'New block'])
    const plugin = session.getBlock(0, 'Alpha beta gamma')
    const processor = unified().use([plugin.rehypePlugin])
    for (let i = 0; i < 2; i++) {
      expect(plugin.getLastRenderCharCount()).toBe(Number.POSITIVE_INFINITY)
      processor.runSync({ type: 'root', children: [{ type: 'text', value: 'Alpha beta gamma' }] } as Root)
    }
    expect(plugin.getLastRenderCharCount()).toBe(Number.POSITIVE_INFINITY)
    session.commit(0, plugin)
    expect(streamingAnimationService.read(id)?.blocks.get(0)).toBe(16)
    expect(session.getBlock(1, 'New block').getLastRenderCharCount()).toBe(0)
  })

  it('keeps a pending plugin boundary stable and rejects late commits from an invalidated generation', () => {
    const session = new MarkdownAnimationSession('late-generation', 'Alpha beta', '{}', {})
    session.captureInitialBlocks(['Alpha beta'])
    const plugin = session.getBlock(0, 'Alpha beta')
    expect(plugin.getLastRenderCharCount()).toBe(0)
    expect(plugin.getLastRenderCharCount()).toBe(0)
    unified()
      .use([plugin.rehypePlugin])
      .runSync({ type: 'root', children: [{ type: 'text', value: 'Alpha beta' }] } as Root)
    streamingAnimationService.delete('late-generation')
    session.commit(0, plugin)
    expect(streamingAnimationService.read('late-generation')).toBeUndefined()
  })
})
