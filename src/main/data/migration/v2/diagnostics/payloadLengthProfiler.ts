import type { MigrationDiagnosticFailureEvidence } from './migrationDiagnosticsSchemas'

const LENGTH_SATURATION = 262_145
const MAX_MEASUREMENTS = 3

type FailedWriteEvidence = Extract<MigrationDiagnosticFailureEvidence, { kind: 'failed_write' }>

export type FailedWriteValue =
  | { readonly role: 'text_value'; readonly kind: 'string'; readonly value: string }
  | { readonly role: 'json_value'; readonly kind: 'json'; readonly value: unknown }

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
  switch (value.kind) {
    case 'string': {
      const byteLength = boundedLength(Buffer.byteLength(value.value, 'utf8'))
      return { role: 'text_value', kind: 'string', byteLength, byteLengthBucket: byteLengthBucket(byteLength) }
    }
    case 'json': {
      const serialized = JSON.stringify(value.value)
      if (serialized === undefined) throw new Error('json_value_not_serializable')
      const byteLength = boundedLength(Buffer.byteLength(serialized, 'utf8'))
      return { role: 'json_value', kind: 'json', byteLength, byteLengthBucket: byteLengthBucket(byteLength) }
    }
  }
}

/**
 * Measure only caller-selected values after an existing write has failed.
 * Any producer/stringify/measurement failure omits the whole evidence branch;
 * callers must always rethrow the original write error unchanged.
 */
export function measureFailedWriteValuesBestEffort(
  values: () => readonly FailedWriteValue[]
): FailedWriteEvidence | undefined {
  try {
    const selected = values()
    const measurements: FailedWriteEvidence['values'] = []
    for (let index = 0; index < selected.length && index < MAX_MEASUREMENTS; index += 1) {
      const value = selected[index]
      if (value !== undefined) measurements.push(measure(value))
    }
    return measurements.length === 0
      ? undefined
      : { kind: 'failed_write', truncated: selected.length > MAX_MEASUREMENTS, values: measurements }
  } catch {
    return undefined
  }
}
