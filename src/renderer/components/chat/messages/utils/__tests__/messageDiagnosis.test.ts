import { UpdateAgentSessionMessageSchema } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart } from '@shared/data/types/message'
import { type DiagnosisResult, readCherryMeta } from '@shared/data/types/uiParts'
import { describe, expect, it } from 'vitest'

import { withMessagePartDiagnosis } from '../messageDiagnosis'

const diagnosis: DiagnosisResult = {
  summary: 'OpenAI API key is invalid',
  category: 'auth',
  explanation: 'The server rejected the request because the key is invalid.',
  steps: [{ text: 'Open provider settings and check the key' }]
}

const errorParts = (): CherryMessagePart[] =>
  [{ type: 'data-error', data: { name: 'AuthError', message: 'Unauthorized' } }] as unknown as CherryMessagePart[]

describe('withMessagePartDiagnosis', () => {
  it('writes the diagnosis under providerMetadata.cherry.diagnosis without mutating the input', () => {
    const parts = errorParts()
    const next = withMessagePartDiagnosis(parts, 0, diagnosis)

    expect(next).not.toBeNull()
    const updated = next![0] as { providerMetadata?: { cherry?: { diagnosis?: unknown } } }
    expect(updated.providerMetadata?.cherry?.diagnosis).toEqual(diagnosis)
    // original untouched
    expect('providerMetadata' in parts[0]).toBe(false)
  })

  it('returns null for an out-of-range index', () => {
    expect(withMessagePartDiagnosis(errorParts(), -1, diagnosis)).toBeNull()
    expect(withMessagePartDiagnosis(errorParts(), 5, diagnosis)).toBeNull()
  })

  it('survives the PATCH API boundary and stays readable via readCherryMeta', () => {
    const next = withMessagePartDiagnosis(errorParts(), 0, diagnosis)
    expect(next).not.toBeNull()

    // The DataApi PATCH body is validated by UpdateAgentSessionMessageSchema →
    // MessageDataSchema, a shallow z.custom that must not strip cherry meta.
    const parsed = UpdateAgentSessionMessageSchema.parse({ data: { parts: next } })
    const parsedPart = (parsed.data.parts as CherryMessagePart[])[0] as Extract<
      CherryMessagePart,
      { type: 'data-error' }
    >

    expect(readCherryMeta(parsedPart)?.diagnosis).toEqual(diagnosis)
  })
})
