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

function Harness() {
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
    editable: true,
    fontSize: 14,
    narrowMode: false
  }

  return <ComposerSurface {...props} />
}

describe('deferred ComposerSurface', () => {
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
