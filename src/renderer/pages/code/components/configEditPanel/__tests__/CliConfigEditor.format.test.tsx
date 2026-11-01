import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@uiw/react-codemirror'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig/types'

import { CliConfigEditor } from '../CliConfigEditor'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

// Formatting a CRLF document must update the real editor without using serialized offsets as document positions.
describe('CliConfigEditor format', () => {
  it('formats CRLF JSON and preserves document coordinates and serialized line endings on subsequent edits', async () => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.message.font_size': 14,
      'chat.code.viewer.theme_light': 'one-light'
    })
    function Host() {
      const [files, setFiles] = useState<CliConfigFileDraft[]>([
        {
          target: 'claude-settings',
          label: 'settings.json',
          path: '/tmp/settings.json',
          language: 'json',
          content: '{\r\n "a":1\r\n}'
        }
      ])
      return (
        <CodeStyleProvider>
          <CliConfigEditor files={files} onChange={setFiles} />
          <output aria-label="Config draft">{files[0].content}</output>
        </CodeStyleProvider>
      )
    }
    const host = render(<Host />)
    await waitFor(() => expect(host.container.querySelector('.cm-editor')).not.toBeNull())
    const editor = () => EditorView.findFromDOM(host.container.querySelector('.cm-editor')!)!
    const formatted = '{\n  "a": 1\n}\n'
    fireEvent.click(screen.getByRole('button', { name: '格式化' }))
    await waitFor(() => expect(editor().state.doc.toString()).toBe(formatted))
    expect(editor().state.doc.lines).toBe(4)
    expect(screen.getByLabelText('Config draft').textContent).toBe(formatted)
    act(() => editor().dispatch({ changes: { from: editor().state.doc.length, insert: ' ' } }))
    expect(screen.getByLabelText('Config draft').textContent).toBe(formatted.replaceAll('\n', '\r\n') + ' ')
  })
})
