import { expect, it } from 'vitest'

import { compactRestorePoint, type NativeArchive } from '../src/archive'

const sessionId = '374c8467-e787-4c67-b890-a3d91b50dba6'
const boundaryId = '590bf21c-a5c3-413d-821e-cd33a4016d33'
const summaryId = '2fcdb52e-39d4-4cc9-aee0-53db2df99c33'
const inputId = '781c8715-59da-426a-8688-481660b69d16'
const boundary = { sessionId, messageUuid: boundaryId }
const records = [
  { type: 'system', subtype: 'compact_boundary', uuid: boundaryId, sessionId },
  { type: 'user', uuid: summaryId, sessionId, parentUuid: boundaryId, isCompactSummary: true },
  { type: 'user', uuid: inputId, sessionId, parentUuid: summaryId }
]
const archive = (entries: { type: string }[]): NativeArchive => ({ messages: [], children: [], entries: [{ entries }] })

it('cuts at the committed summary even when a later input has arrived', () => {
  expect(compactRestorePoint(archive(records), boundary)).toEqual({ sessionId, messageUuid: summaryId })
})

it('refuses missing, duplicated, unlinked or ambiguous native evidence', () => {
  for (const entries of [
    records.slice(0, 1),
    [...records, records[0]],
    [records[0], { ...records[1], parentUuid: inputId }],
    [records[0], records[1], { ...records[2], type: 'assistant' }],
    [records[0], { ...records[1], sessionId: inputId }]
  ])
    expect(compactRestorePoint(archive(entries), boundary)).toBeUndefined()
})
