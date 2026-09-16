import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { uiSelector } from '@renderer/utils/uiContract'

import ComposerSurface from '../ComposerSurfaceRuntime'
import { ComposerToolProvider } from '../tools/ComposerToolProvider'

function Harness({ editable }: { editable: boolean }) {
  const [text, setText] = useState('Draft')
  const [files, setFiles] = useState<ComposerAttachment[]>([])
  return (
    <QuickPanelProvider>
      <ComposerToolProvider actions={{ addNewTopic: () => {}, onTextChange: setText }}>
        <output aria-label="Attachments">{files.map((file) => file.name).join(',')}</output>
        <ComposerSurface
          text={text}
          onTextChange={setText}
          tokens={[]}
          managedTokenKinds={[]}
          onTokensChange={() => {}}
          placeholder="Message"
          sendDisabled={false}
          isLoading={false}
          onSendDraft={() => {}}
          onPause={() => {}}
          supportedExts={['.md']}
          setFiles={setFiles}
          filesCount={files.length}
          isExpanded={false}
          onExpandedChange={() => {}}
          quickPanelEnabled={false}
          enableDragDrop
          enableSpellCheck={false}
          editable={editable}
          fontSize={14}
          narrowMode={false}
        />
      </ComposerToolProvider>
    </QuickPanelProvider>
  )
}

const originalApi = window.api
const rangeGeometry = ['getClientRects', 'getBoundingClientRect'] as const
const originalRangeGeometry = rangeGeometry.map((name) => Object.getOwnPropertyDescriptor(Range.prototype, name))

describe('composer read-only drops', () => {
  beforeEach(() => {
    // JSDOM has no layout; Tiptap's focus command reads range geometry.
    Range.prototype.getClientRects = () => Object.assign([], { item: () => null })
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  afterEach(() => {
    Object.defineProperty(window, 'api', { configurable: true, value: originalApi })
    rangeGeometry.forEach((name, index) => {
      const descriptor = originalRangeGeometry[index]
      if (descriptor) Object.defineProperty(Range.prototype, name, descriptor)
      else Reflect.deleteProperty(Range.prototype, name)
    })
  })
  it('blocks text drops while read-only and accepts them after editing resumes', async () => {
    const view = render(<Harness editable />)
    const input = view.container.querySelector(uiSelector({ parts: ['composer-input'] }))!
    await waitFor(() => expect(input.querySelector('[contenteditable]')).toHaveAttribute('contenteditable', 'true'))
    view.rerender(<Harness editable={false} />)
    await waitFor(() => expect(input.querySelector('[contenteditable]')).toHaveAttribute('contenteditable', 'false'))
    const drop = async () => {
      await act(async () => {
        fireEvent.drop(input, { dataTransfer: { files: [], items: [], getData: () => 'Dropped text' } })
      })
    }
    await drop()
    expect(input).toHaveTextContent('Draft')
    expect(input).not.toHaveTextContent('Dropped text')
    expect(screen.getByLabelText('Attachments')).toBeEmptyDOMElement()
    view.rerender(<Harness editable />)
    await drop()
    await waitFor(() => expect(input).toHaveTextContent('Dropped text'))
  })

  it.each(['file', 'directory'] as const)(
    'blocks %s drops while read-only and accepts them after editing resumes',
    async (kind) => {
      const name = kind === 'file' ? 'note.md' : 'Project Notes'
      const path = `/tmp/${name}`
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: {
          ...window.api,
          file: {
            ...window.api.file,
            getPathForFile: () => path,
            get: async () => ({
              id: 'drop',
              name,
              origin_name: name,
              path,
              size: 12,
              ext: '.md',
              type: FILE_TYPE.TEXT,
              created_at: '',
              count: 1
            })
          },
          ipcApi: {
            ...window.api.ipcApi,
            request: vi.fn().mockResolvedValue({ ok: true, data: { kind } })
          }
        }
      })
      const view = render(<Harness editable />)
      const input = view.container.querySelector(uiSelector({ parts: ['composer-input'] }))!
      await waitFor(() => expect(input.querySelector('[contenteditable]')).toHaveAttribute('contenteditable', 'true'))
      view.rerender(<Harness editable={false} />)
      await waitFor(() => expect(input.querySelector('[contenteditable]')).toHaveAttribute('contenteditable', 'false'))
      const drop = async () => {
        await act(async () => {
          fireEvent.drop(input, { dataTransfer: { files: [new File(['test'], name)], items: [], getData: () => '' } })
        })
      }
      await drop()
      expect(input).toHaveTextContent('Draft')
      expect(input).not.toHaveTextContent(name)
      expect(screen.getByLabelText('Attachments')).toBeEmptyDOMElement()
      view.rerender(<Harness editable />)
      await drop()
      await waitFor(() =>
        expect(kind === 'file' ? screen.getByLabelText('Attachments') : input).toHaveTextContent(name)
      )
    }
  )
})
