import { act, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { expect, it } from 'vitest'

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AbsoluteFilePath } from '@shared/types/file'

import { ComposerContextProvider } from '../ComposerContext'
import ComposerCore from '../ComposerCore'
import type { ComposerDraftToken } from '../tokens'
import { useComposerSelectionReferenceInsertion } from '../variants/shared/useComposerSelectionReferenceInsertion'

function Composer({ name }: { name: string }) {
  const [text, setText] = useState(name)
  const actions = useRef({
    getDraft: () => ({ text }),
    insertToken: (token: ComposerDraftToken) => setText((current) => current + token.promptText)
  })
  actions.current.getDraft = () => ({ text })
  useComposerSelectionReferenceInsertion(actions, 'session')
  return <textarea aria-label={name} value={text} readOnly />
}

function Conversation({ editing }: { editing: boolean }) {
  return (
    <ComposerContextProvider
      value={{ overrides: editing ? [{ id: 'edit', render: () => <Composer name="edited message" /> }] : [] }}>
      <ComposerCore fallback={<Composer name="ordinary draft" />} />
    </ComposerContextProvider>
  )
}

it('routes external selections to the active editor and preserves the ordinary draft after cancelling', async () => {
  const view = render(<Conversation editing={false} />)
  const ordinary = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'ordinary draft' })
  view.rerender(<Conversation editing />)

  const insert = () =>
    act(async () => {
      await EventEmitter.emit(EVENT_NAMES.INSERT_COMPOSER_SELECTION_REFERENCE, {
        topicId: 'session',
        reference: {
          path: '/workspace/report.xlsx' as AbsoluteFilePath,
          anchor: { format: 'xlsx', sheet: 'Sheet1', range: 'B2' },
          excerpt: 'selected revenue',
          fileStamp: { size: 100, mtimeMs: 1 }
        }
      })
    })

  await insert()
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'edited message' }).value).toContain(
    'selected revenue'
  )
  expect(ordinary).toHaveValue('ordinary draft')

  view.rerender(<Conversation editing={false} />)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'ordinary draft' })).toHaveValue('ordinary draft')
  await insert()
  expect(ordinary.value).toContain('selected revenue')
})
