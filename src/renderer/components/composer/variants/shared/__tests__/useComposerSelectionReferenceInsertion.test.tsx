import { act, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import type { ComposerDraftToken } from '@renderer/components/composer/tokens'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { SelectionReference } from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'

import { useComposerSelectionReferenceInsertion } from '../useComposerSelectionReferenceInsertion'

const TOPIC_ID = 'agent-session-topic'

const REFERENCE: SelectionReference = {
  path: '/Users/dev/workspace/report.xlsx' as AbsoluteFilePath,
  anchor: { format: 'xlsx', sheet: 'Sheet1', range: 'B2:D8' },
  excerpt: 'Q3 revenue 12,400',
  fileStamp: { size: 20481, mtimeMs: 1750000000000 }
}

function Harness({ draftText }: { draftText: string }) {
  const [text, setText] = useState(draftText)
  const actionsRef = useRef({
    getDraft: () => ({ text }),
    insertToken: (token: ComposerDraftToken) => setText((current) => current + token.promptText)
  })
  actionsRef.current.getDraft = () => ({ text })
  useComposerSelectionReferenceInsertion(actionsRef, TOPIC_ID)
  return <textarea aria-label="Draft" value={text} readOnly />
}

const emit = (payload: unknown) =>
  act(async () => {
    await EventEmitter.emit(EVENT_NAMES.INSERT_COMPOSER_SELECTION_REFERENCE, payload)
  })

describe('useComposerSelectionReferenceInsertion', () => {
  it('inserts the complete selection into a draft beyond the former input limit', async () => {
    const draft = 'x'.repeat(250000)
    const excerpt = 'selected text '.repeat(4000) + 'selection tail'
    render(<Harness draftText={draft} />)

    await emit({ topicId: TOPIC_ID, reference: { ...REFERENCE, excerpt } })

    const text = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Draft' }).value
    expect(text.startsWith(draft)).toBe(true)
    expect(text).toContain(excerpt)
    expect(text).toContain('report.xlsx')
    expect(text).toContain('B2:D8')
  })

  it('ignores selections addressed to another composer in the same window', async () => {
    render(<Harness draftText="Keep my draft" />)

    await emit({ topicId: 'a-different-topic', reference: REFERENCE })

    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep my draft')
  })
})
