import type { DoctorFixRequest } from '@shared/types/doctor'
import { describe, expect, it } from 'vitest'

import { createDoctorSession, doctorSessionReducer } from '../doctorSessionReducer'

const fixRequest: DoctorFixRequest = {
  runId: 'run-1',
  checkId: 'storage-disk-space',
  fixId: 'cleanup'
}

describe('doctorSessionReducer', () => {
  it('keeps one report draft while switching panels', () => {
    let state = createDoctorSession({ initialPanel: 'report', initialDescription: 'safe draft' })

    state = doctorSessionReducer(state, { type: 'set-description', description: 'reviewed draft' })
    state = doctorSessionReducer(state, { type: 'set-panel', panel: 'checks' })
    state = doctorSessionReducer(state, { type: 'set-panel', panel: 'report' })

    expect(state.descriptionDraft).toBe('reviewed draft')
  })

  it('represents confirmation and execution as a mutually exclusive interaction', () => {
    let state = createDoctorSession({ initialPanel: 'checks' })

    state = doctorSessionReducer(state, { type: 'confirm-fix', request: fixRequest })
    expect(state.interaction).toEqual({ kind: 'confirm-fix', request: fixRequest })

    state = doctorSessionReducer(state, {
      type: 'start-interaction',
      interaction: { kind: 'fixing', request: fixRequest }
    })
    expect(state.interaction).toEqual({ kind: 'fixing', request: fixRequest })

    state = doctorSessionReducer(state, { type: 'finish-interaction', kind: 'report-operation' })
    expect(state.interaction.kind).toBe('fixing')

    state = doctorSessionReducer(state, { type: 'finish-interaction', kind: 'fixing' })
    expect(state.interaction).toEqual({ kind: 'idle' })
  })
})
