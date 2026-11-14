import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { validateForkClosure } from '../forkValidation'

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
]
const mapped = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
]
const session = 'source'
function fixture() {
  const source = ids.map((uuid) => ({ type: 'user', uuid })) as SessionStoreEntry[]
  const output = mapped.map((uuid, index) => ({
    type: 'user',
    uuid,
    forkedFrom: { sessionId: session, messageUuid: ids[index] }
  })) as SessionStoreEntry[]
  source[2].compactMetadata = {
    preservedSegment: { headUuid: ids[0], anchorUuid: ids[1], tailUuid: ids[0] },
    preservedMessages: { anchorUuid: ids[1], uuids: [ids[0], ids[1]], allUuids: [ids[0], ids[0]] },
    opaque: ids[0]
  }
  output[2].compactMetadata = {
    preservedSegment: { headUuid: mapped[0], anchorUuid: mapped[1], tailUuid: mapped[0] },
    preservedMessages: { anchorUuid: mapped[1], uuids: [mapped[0], mapped[1]], allUuids: [mapped[0], mapped[0]] },
    added: { [ids[0]]: ids[1] }
  }
  return { source, output }
}
const fields = [
  ['preservedSegment', 'headUuid'],
  ['preservedSegment', 'anchorUuid'],
  ['preservedSegment', 'tailUuid'],
  ['preservedMessages', 'anchorUuid'],
  ['preservedMessages', 'uuids'],
  ['preservedMessages', 'allUuids']
] as const
function metadata(entries: SessionStoreEntry[], group: string): Record<string, unknown> {
  return (entries[2].compactMetadata as Record<string, Record<string, unknown>>)[group]
}
describe('fork reference closure', () => {
  it('accepts closed references, duplicate allUuids and unrelated metadata changes', () => {
    const { source, output } = fixture()
    expect(validateForkClosure(source, output, session).get(ids[0])).toBe(mapped[0])
  })
  it.each(fields)('rejects dangling source %s.%s', (group, field) => {
    const { source, output } = fixture()
    metadata(source, group)[field] =
      field.endsWith('uids') || field === 'allUuids'
        ? ['dddddddd-dddd-4ddd-8ddd-dddddddddddd']
        : 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    expect(() => validateForkClosure(source, output, session)).toThrow('unsupported_checkpoint')
  })
  it.each(fields)('rejects wrong output %s.%s', (group, field) => {
    const { source, output } = fixture()
    const value = metadata(output, group)[field]
    metadata(output, group)[field] = Array.isArray(value)
      ? value.map((item, index) => (index === 0 ? mapped[2] : item))
      : mapped[2]
    expect(() => validateForkClosure(source, output, session)).toThrow('unsupported_checkpoint')
  })
  it.each(fields)('rejects dropped output %s.%s', (group, field) => {
    const { source, output } = fixture()
    delete metadata(output, group)[field]
    expect(() => validateForkClosure(source, output, session)).toThrow('unsupported_checkpoint')
  })
  it.each(fields)('rejects stale output %s.%s', (group, field) => {
    const { source, output } = fixture()
    const value = metadata(output, group)[field]
    metadata(output, group)[field] = Array.isArray(value) ? value.map(() => ids[0]) : ids[0]
    output.splice(0, 1)
    expect(() => validateForkClosure(source, output, session)).toThrow('unsupported_checkpoint')
  })
  it.each(
    fields.flatMap(
      ([group, field]) =>
        [
          [group, field, 'source'],
          [group, field, 'output']
        ] as const
    )
  )('rejects malformed %s.%s in %s', (group, field, side) => {
    const { source, output } = fixture()
    metadata(side === 'source' ? source : output, group)[field] = 42
    expect(() => validateForkClosure(source, output, session)).toThrow('history_corrupt')
  })
  it('rejects missing provenance required by a reference', () => {
    const { source, output } = fixture()
    delete output[0].forkedFrom
    expect(() => validateForkClosure(source, output, session)).toThrow('history_corrupt')
  })
  it('rejects distinct source identities collapsing to one output identity', () => {
    const { source, output } = fixture()
    output[1].uuid = output[0].uuid
    expect(() => validateForkClosure(source, output, session)).toThrow('history_corrupt')
  })
  it('reports an unmapped replacement target as unsupported', () => {
    const { source, output } = fixture()
    source.push({ type: 'content-replacement', replacements: [{ messageUuid: ids[0] }] })
    output.push({ type: 'content-replacement', replacements: [{ messageUuid: ids[0] }] })
    delete output[0].forkedFrom
    delete source[2].compactMetadata
    delete output[2].compactMetadata
    expect(() => validateForkClosure(source, output, session)).toThrow('unsupported_checkpoint')
  })
  it('rejects duplicate ordered references', () => {
    const { source, output } = fixture()
    metadata(source, 'preservedMessages').uuids = [ids[0], ids[0]]
    expect(() => validateForkClosure(source, output, session)).toThrow('history_corrupt')
  })
  it('rejects malformed and duplicate identities', () => {
    const { source, output } = fixture()
    source[0].uuid = 'bad'
    expect(() => validateForkClosure(source, output, session)).toThrow('history_corrupt')
    source[0].uuid = ids[0]
    output[1].uuid = mapped[0]
    expect(() => validateForkClosure(source, output, session)).toThrow('history_corrupt')
  })
  it('checks replacement targets and content without scanning content', () => {
    const { source, output } = fixture()
    source.push({
      type: 'content-replacement',
      replacements: [{ messageUuid: ids[0], content: ids[0] }]
    })
    output.push({
      type: 'content-replacement',
      replacements: [{ messageUuid: mapped[0], content: ids[0] }]
    })
    expect(() => validateForkClosure(source, output, session)).not.toThrow()
    ;(output.at(-1)!.replacements as Array<Record<string, unknown>>)[0].content = 'substituted'
    expect(() => validateForkClosure(source, output, session)).toThrow('unsupported_checkpoint')
  })
})
