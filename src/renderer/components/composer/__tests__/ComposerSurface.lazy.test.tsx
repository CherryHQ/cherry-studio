import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ComposerSurface, { type ComposerSurfaceProps } from '../ComposerSurface'

const mocks = vi.hoisted(() => ({
  onSendDraft: vi.fn(),
  runtimeLoads: 0
}))

vi.mock('@renderer/components/SendMessageButton', () => ({
  default: ({ sendMessage }: { sendMessage: () => void }) => (
    <button type="button" onClick={sendMessage}>
      Send
    </button>
  )
}))

vi.mock('../ComposerSurfaceRuntime', () => {
  mocks.runtimeLoads += 1
  return {
    default: ({ initialTextSelection, text }: ComposerSurfaceProps) => (
      <div
        data-testid="composer-runtime"
        data-selection={`${initialTextSelection?.start}:${initialTextSelection?.end}`}>
        {text}
      </div>
    )
  }
})

function Harness({ editable = true }: { editable?: boolean } = {}) {
  const [text, setText] = useState('draft')
  const props: ComposerSurfaceProps = {
    text,
    onTextChange: setText,
    tokens: [],
    managedTokenKinds: [],
    onTokensChange: vi.fn(),
    placeholder: 'Message',
    sendMessageShortcut: 'Enter',
    sendDisabled: false,
    isLoading: false,
    onSendDraft: mocks.onSendDraft,
    onPause: vi.fn(),
    supportedExts: [],
    setFiles: vi.fn(),
    filesCount: 0,
    isExpanded: false,
    onExpandedChange: vi.fn(),
    quickPanelEnabled: true,
    enableDragDrop: true,
    enableSpellCheck: true,
    editable,
    fontSize: 14,
    narrowMode: true,
    renderLeftControls: () => <span>Composer tools</span>
  }

  return <ComposerSurface {...props} />
}

describe('deferred ComposerSurface', () => {
  it('matches the regular composer shell before loading the rich runtime', () => {
    const { container } = render(<Harness editable={undefined} />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    const inputbar = container.querySelector<HTMLElement>('[data-composer-inputbar]')
    const narrowLayout = container.querySelector<HTMLElement>('.narrow-mode')

    expect(input).toBeEnabled()
    expect(input).toHaveClass('w-full')
    expect(input).toHaveAttribute('rows', '1')
    expect(input).toHaveStyle({ height: '46px', minHeight: '46px', lineHeight: '1.4' })
    expect(narrowLayout).toHaveClass('max-w-[calc(800px+3rem)]', 'px-6')
    expect(narrowLayout).toContainElement(inputbar)
    expect(inputbar).toContainElement(screen.getByText('Composer tools'))
    expect(inputbar?.querySelector('[data-composer-toolbar]')).toContainElement(
      screen.getByRole('button', { name: 'Send' })
    )
    expect(mocks.runtimeLoads).toBe(0)
  })

  it('keeps a usable textarea and IME state until the rich runtime can replace it', async () => {
    render(<Harness />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    expect(input).toHaveValue('draft')
    expect(mocks.runtimeLoads).toBe(0)

    fireEvent.focus(input)
    expect(mocks.runtimeLoads).toBe(0)

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'draft text', selectionStart: 10, selectionEnd: 10 } })
    await waitFor(() => expect(mocks.runtimeLoads).toBe(1))
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('draft text')

    fireEvent.compositionEnd(input, { currentTarget: { selectionStart: 10, selectionEnd: 10 } })
    const runtime = await screen.findByTestId('composer-runtime')
    expect(runtime).toHaveTextContent('draft text')
    expect(runtime).toHaveAttribute('data-selection', '10:10')
  })
})
