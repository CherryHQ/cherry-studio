import { COMPOSER_INPUT_MAX_LENGTH } from '@renderer/components/composer/composerDraft'
import { createSelectionReferenceToken } from '@renderer/components/composer/selectionReferenceToken'
import type { ComposerDraftToken } from '@renderer/components/composer/tokens'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { SelectionReference } from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useComposerSelectionReferenceInsertion } from '../composerSelectionReference'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn()
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

/** The hook passes its own `t` through; these tests only need promptText, which never goes through it. */
const echoKey = (key: string) => key

const TOPIC_ID = 'agent-session-topic'

const REFERENCE: SelectionReference = {
  path: '/Users/dev/workspace/report.xlsx' as AbsoluteFilePath,
  anchor: { format: 'xlsx', sheet: 'Sheet1', range: 'B2:D8' },
  excerpt: 'Q3 revenue 12,400',
  fileStamp: { size: 20481, mtimeMs: 1750000000000 }
}

function Harness({ draftText, onInsert }: { draftText: string; onInsert: (token: ComposerDraftToken) => void }) {
  const actionsRef = useRef({ getDraft: () => ({ text: draftText }), insertToken: onInsert })
  actionsRef.current = { getDraft: () => ({ text: draftText }), insertToken: onInsert }
  useComposerSelectionReferenceInsertion(actionsRef, TOPIC_ID)
  return null
}

/** Emittery delivers on a microtask, so the emit has to be awaited before asserting. */
const emit = (payload: unknown) =>
  act(async () => {
    await EventEmitter.emit(EVENT_NAMES.INSERT_COMPOSER_SELECTION_REFERENCE, payload)
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useComposerSelectionReferenceInsertion', () => {
  it('inserts the reference when the draft has room', async () => {
    const onInsert = vi.fn()
    render(<Harness draftText="" onInsert={onInsert} />)

    await emit({ topicId: TOPIC_ID, reference: REFERENCE })

    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('refuses the insertion instead of pushing the draft past the input limit', async () => {
    // Token insertion bypasses the typing and paste guards, so this path has to budget on its own.
    const onInsert = vi.fn()
    render(<Harness draftText={'x'.repeat(COMPOSER_INPUT_MAX_LENGTH - 10)} onInsert={onInsert} />)

    await emit({ topicId: TOPIC_ID, reference: REFERENCE })

    expect(onInsert).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('chat.input.reference_panel.no_room_selection')
  })

  it('counts the separator space insertToken appends, not just promptText', async () => {
    // Room for the block itself but not for the trailing space: accepting here would land the draft one
    // character past the limit.
    const onInsert = vi.fn()
    const promptLength = createSelectionReferenceToken(REFERENCE, echoKey).promptText?.length ?? 0
    render(<Harness draftText={'x'.repeat(COMPOSER_INPUT_MAX_LENGTH - promptLength)} onInsert={onInsert} />)

    await emit({ topicId: TOPIC_ID, reference: REFERENCE })

    expect(onInsert).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('chat.input.reference_panel.no_room_selection')
  })

  it('still inserts when the block and its separator both fit exactly', async () => {
    const onInsert = vi.fn()
    const promptLength = createSelectionReferenceToken(REFERENCE, echoKey).promptText?.length ?? 0
    render(<Harness draftText={'x'.repeat(COMPOSER_INPUT_MAX_LENGTH - promptLength - 1)} onInsert={onInsert} />)

    await emit({ topicId: TOPIC_ID, reference: REFERENCE })

    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('ignores selections addressed to another composer in the same window', async () => {
    const onInsert = vi.fn()
    render(<Harness draftText="" onInsert={onInsert} />)

    await emit({ topicId: 'a-different-topic', reference: REFERENCE })

    expect(onInsert).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
