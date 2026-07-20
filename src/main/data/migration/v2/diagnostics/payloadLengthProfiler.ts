import type { MigrationDiagnosticFailureEvidence } from './migrationDiagnosticsSchemas'

const LENGTH_SATURATION = 262_145
const MAX_MEASUREMENTS = 3

type FailedWriteEvidence = Extract<MigrationDiagnosticFailureEvidence, { kind: 'failed_write' }>
export type FailedWriteOperationRole = FailedWriteEvidence['operationRole']

export type FailedWriteValue =
  | { readonly role: 'text_value'; readonly kind: 'string'; readonly value: string }
  | { readonly role: 'json_value'; readonly kind: 'json'; readonly value: unknown }
  | { readonly role: 'blob_value'; readonly kind: 'blob'; readonly byteLength: number }

function boundedLength(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 && value < LENGTH_SATURATION ? value : LENGTH_SATURATION
}

function byteLengthBucket(byteLength: number): FailedWriteEvidence['values'][number]['byteLengthBucket'] {
  if (byteLength === 0) return '0'
  if (byteLength <= 256) return '1-256'
  if (byteLength <= 4_096) return '257-4096'
  if (byteLength <= 65_536) return '4097-65536'
  if (byteLength <= 262_144) return '65537-262144'
  return '262145+'
}

function measure(value: FailedWriteValue): FailedWriteEvidence['values'][number] {
  let byteLength: number
  if (value.kind === 'string') {
    byteLength = boundedLength(Buffer.byteLength(value.value, 'utf8'))
  } else if (value.kind === 'json') {
    const serialized = JSON.stringify(value.value)
    if (serialized === undefined) throw new Error('json_value_not_serializable')
    byteLength = boundedLength(Buffer.byteLength(serialized, 'utf8'))
  } else {
    byteLength = boundedLength(value.byteLength)
  }

  const bucket = byteLengthBucket(byteLength)
  switch (value.kind) {
    case 'string':
      return { role: 'text_value', kind: 'string', byteLength, byteLengthBucket: bucket }
    case 'json':
      return { role: 'json_value', kind: 'json', byteLength, byteLengthBucket: bucket }
    case 'blob':
      return { role: 'blob_value', kind: 'blob', byteLength, byteLengthBucket: bucket }
  }
}

/**
 * Measure only caller-selected values after an existing write has failed.
 * Any producer/stringify/measurement failure omits the whole evidence branch;
 * callers must always rethrow the original write error unchanged.
 */
export function measureFailedWriteValuesBestEffort(
  values: () => readonly FailedWriteValue[],
  operationRole: FailedWriteOperationRole = 'insert'
): FailedWriteEvidence | undefined {
  try {
    const selected = values()
    const measurements: FailedWriteEvidence['values'] = []
    for (let index = 0; index < selected.length && index < MAX_MEASUREMENTS; index += 1) {
      const value = selected[index]
      if (value !== undefined) measurements.push(measure(value))
    }
    return measurements.length === 0 ? undefined : { kind: 'failed_write', operationRole, values: measurements }
  } catch {
    return undefined
  }
}
