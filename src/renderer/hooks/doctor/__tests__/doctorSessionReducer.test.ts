import type { DoctorFixRequest } from '@shared/types/doctor'
import { describe, expect, it } from 'vitest'

import { createDoctorSession, doctorSessionReducer } from '../doctorSessionReducer'

const fixRequest: DoctorFixRequest = {
  runId: 'run-1',
  checkId: 'permission-screen-capture',
  fixId: 'request'
}

describe('doctorSessionReducer', () => {
  it('cancels only an active evidence confirmation', () => {
    const initial = createDoctorSession({ initialPanel: 'checks' })
    const confirming = doctorSessionReducer(initial, {
      type: 'confirm-evidence',
      checkId: 'runtime-claude-login'
    })

    expect(doctorSessionReducer(confirming, { type: 'cancel-confirmation' }).interaction).toEqual({ kind: 'idle' })
    expect(doctorSessionReducer(initial, { type: 'cancel-confirmation' })).toBe(initial)
  })

  it('reveals consent-required evidence once', () => {
    const initial = createDoctorSession({ initialPanel: 'checks' })
    const revealed = doctorSessionReducer(initial, {
      type: 'reveal-evidence',
      checkId: 'runtime-claude-login'
    })

    expect(revealed.revealedEvidence).toEqual(['runtime-claude-login'])
    expect(doctorSessionReducer(revealed, { type: 'reveal-evidence', checkId: 'runtime-claude-login' })).toBe(revealed)
  })

  it('keeps one report draft while switching panels', () => {
    let state = createDoctorSession({ initialPanel: 'report', initialDescription: 'safe draft' })

    state = doctorSessionReducer(state, { type: 'set-description', description: 'reviewed draft' })
    state = doctorSessionReducer(state, { type: 'set-panel', panel: 'checks' })
    state = doctorSessionReducer(state, { type: 'set-panel', panel: 'report' })

    expect(state.descriptionDraft).toBe('reviewed draft')
  })

  it('finishes only the matching execution interaction', () => {
    let state = createDoctorSession({ initialPanel: 'checks' })

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
