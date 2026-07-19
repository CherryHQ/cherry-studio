import {
  type LengthBucket,
  PAYLOAD_PROFILE_SLOTS,
  PAYLOAD_PROFILE_TARGETS,
  type PayloadLengthProfile,
  type PayloadLengthSlotProfile,
  type PayloadProfileDescriptor,
  type PayloadProfileSlot,
  type RowCountBucket
} from './migrationDiagnosticsSchemas'

const MAX_DEPTH = 8
const MAX_NODES = 1_024
const MAX_DESCRIPTOR_FIELDS = 64
const DEADLINE_MS = 5
const LENGTH_SATURATION = 262_145

type ProfiledKind = 'string' | 'bytes' | 'json' | 'unsupported'

interface TraversalContext {
  readonly deadline: number
  nodes: number
  truncated: boolean
}

interface JsonMeasurement {
  readonly included: boolean
  readonly serializedBytes: number
  readonly maxStringCharLength: number
  readonly maxStringByteLength: number
  readonly truncated: boolean
}

interface SlotAccumulator {
  readonly slot: PayloadProfileSlot
  readonly kinds: Set<ProfiledKind>
  stringTotalBytes: number
  stringMaxChars: number
  stringMaxBytes: number
  bytesTotal: number
  bytesMax: number
  jsonTotalBytes: number
  jsonMaxBytes: number
  jsonMaxStringChars: number
  jsonMaxStringBytes: number
  truncated: boolean
}

const payloadSlotSet = new Set<string>(PAYLOAD_PROFILE_SLOTS)
const payloadTargetSet = new Set<string>(PAYLOAD_PROFILE_TARGETS)
const objectHasOwn = Object.hasOwn
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get

function saturatingAdd(left: number, right: number): number {
  return Math.min(LENGTH_SATURATION, left + right)
}

function lengthBucket(length: number): LengthBucket {
  if (length === 0) return '0'
  if (length <= 256) return '1-256'
  if (length <= 4_096) return '257-4096'
  if (length <= 65_536) return '4097-65536'
  if (length <= 262_144) return '65537-262144'
  return '262145+'
}

function rowCountBucket(count: number): RowCountBucket {
  if (count === 0) return '0'
  if (count === 1) return '1'
  if (count <= 10) return '2-10'
  if (count <= 100) return '11-100'
  if (count <= 1_000) return '101-1000'
  return '1001+'
}

function deadlineExceeded(context: TraversalContext): boolean {
  if (performance.now() <= context.deadline) return false
  context.truncated = true
  return true
}

function utf8CodeUnitBytes(value: string, index: number): { bytes: number; consumed: number } {
  const code = value.charCodeAt(index)
  if (code <= 0x7f) return { bytes: 1, consumed: 1 }
  if (code <= 0x7ff) return { bytes: 2, consumed: 1 }
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
    const next = value.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) return { bytes: 4, consumed: 2 }
  }
  return { bytes: 3, consumed: 1 }
}

function measureUtf8(value: string, context: TraversalContext): { bytes: number; complete: boolean } {
  let bytes = 0
  for (let index = 0; index < value.length; ) {
    if ((index & 0xfff) === 0 && deadlineExceeded(context)) return { bytes, complete: false }
    const measured = utf8CodeUnitBytes(value, index)
    bytes = saturatingAdd(bytes, measured.bytes)
    if (bytes === LENGTH_SATURATION) return { bytes, complete: true }
    index += measured.consumed
  }
  return { bytes, complete: true }
}

function measureJsonString(
  value: string,
  context: TraversalContext
): { bytes: number; rawBytes: number; complete: boolean } {
  let bytes = 2
  let rawBytes = 0

  for (let index = 0; index < value.length; ) {
    if ((index & 0xfff) === 0 && deadlineExceeded(context)) return { bytes, rawBytes, complete: false }
    const code = value.charCodeAt(index)
    const measured = utf8CodeUnitBytes(value, index)
    rawBytes = saturatingAdd(rawBytes, measured.bytes)

    if (code >= 0xd800 && code <= 0xdfff && measured.consumed === 1) {
      bytes = saturatingAdd(bytes, 6)
    } else if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes = saturatingAdd(bytes, 2)
    } else if (code < 0x20) {
      bytes = saturatingAdd(bytes, 6)
    } else {
      bytes = saturatingAdd(bytes, measured.bytes)
    }

    if (bytes === LENGTH_SATURATION && rawBytes === LENGTH_SATURATION) {
      return { bytes, rawBytes, complete: true }
    }
    index += measured.consumed
  }

  return { bytes, rawBytes, complete: true }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function isPlainObject(value: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function isArray(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value)
  } catch {
    return false
  }
}

function ownDataDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor ? descriptor : undefined
  } catch {
    return undefined
  }
}

function uint8ArrayByteLength(value: unknown): number | undefined {
  if (!ArrayBuffer.isView(value)) return undefined
  try {
    if (typedArrayTagGetter?.call(value) !== 'Uint8Array') return undefined
    const byteLength = typedArrayByteLengthGetter?.call(value)
    return typeof byteLength === 'number' ? byteLength : undefined
  } catch {
    return undefined
  }
}

function truncatedJsonMeasurement(included: boolean): JsonMeasurement {
  return {
    included,
    serializedBytes: included ? 4 : 0,
    maxStringCharLength: 0,
    maxStringByteLength: 0,
    truncated: true
  }
}

function measureJson(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  context: TraversalContext
): JsonMeasurement {
  if (deadlineExceeded(context)) return truncatedJsonMeasurement(true)
  if (depth > MAX_DEPTH || context.nodes >= MAX_NODES) {
    context.truncated = true
    return truncatedJsonMeasurement(true)
  }
  context.nodes += 1

  if (value === null) {
    return { included: true, serializedBytes: 4, maxStringCharLength: 0, maxStringByteLength: 0, truncated: false }
  }

  if (typeof value === 'string') {
    const measured = measureJsonString(value, context)
    return {
      included: true,
      serializedBytes: measured.bytes,
      maxStringCharLength: Math.min(LENGTH_SATURATION, value.length),
      maxStringByteLength: measured.rawBytes,
      truncated: !measured.complete
    }
  }

  if (typeof value === 'number') {
    const serialized = Number.isFinite(value) ? JSON.stringify(value) : 'null'
    return {
      included: true,
      serializedBytes: serialized.length,
      maxStringCharLength: 0,
      maxStringByteLength: 0,
      truncated: false
    }
  }

  if (typeof value === 'boolean') {
    return {
      included: true,
      serializedBytes: value ? 4 : 5,
      maxStringCharLength: 0,
      maxStringByteLength: 0,
      truncated: false
    }
  }

  if (!isObjectLike(value) || ArrayBuffer.isView(value)) {
    context.truncated = true
    return truncatedJsonMeasurement(false)
  }
  if (ancestors.has(value)) {
    context.truncated = true
    return truncatedJsonMeasurement(true)
  }

  const arrayValue = isArray(value)
  if (!arrayValue && !isPlainObject(value)) {
    context.truncated = true
    return truncatedJsonMeasurement(false)
  }

  ancestors.add(value)
  let serializedBytes = 2
  let maxStringCharLength = 0
  let maxStringByteLength = 0
  let truncated = false

  if (arrayValue) {
    const array = value
    for (let index = 0; index < array.length; index++) {
      if (context.nodes >= MAX_NODES) {
        context.truncated = true
        truncated = true
        break
      }
      if (index > 0) serializedBytes = saturatingAdd(serializedBytes, 1)
      const descriptor = ownDataDescriptor(array, String(index))
      const child = measureJson(descriptor?.value ?? null, depth + 1, ancestors, context)
      serializedBytes = saturatingAdd(serializedBytes, child.included ? child.serializedBytes : 4)
      maxStringCharLength = Math.max(maxStringCharLength, child.maxStringCharLength)
      maxStringByteLength = Math.max(maxStringByteLength, child.maxStringByteLength)
      truncated ||= child.truncated
      if (deadlineExceeded(context)) {
        truncated = true
        break
      }
    }
  } else {
    let includedProperties = 0
    try {
      for (const name in value) {
        if (context.nodes >= MAX_NODES) {
          context.truncated = true
          truncated = true
          break
        }
        if (deadlineExceeded(context)) {
          truncated = true
          break
        }
        if (!objectHasOwn(value, name)) continue
        const descriptor = ownDataDescriptor(value, name)
        if (deadlineExceeded(context)) {
          truncated = true
          break
        }
        if (!descriptor?.enumerable) continue
        const child = measureJson(descriptor.value, depth + 1, ancestors, context)
        truncated ||= child.truncated
        if (!child.included) continue

        if (includedProperties > 0) serializedBytes = saturatingAdd(serializedBytes, 1)
        const key = measureJsonString(name, context)
        serializedBytes = saturatingAdd(serializedBytes, saturatingAdd(key.bytes, 1))
        serializedBytes = saturatingAdd(serializedBytes, child.serializedBytes)
        maxStringCharLength = Math.max(maxStringCharLength, child.maxStringCharLength)
        maxStringByteLength = Math.max(maxStringByteLength, child.maxStringByteLength)
        truncated ||= !key.complete
        includedProperties += 1
        if (deadlineExceeded(context)) {
          truncated = true
          break
        }
      }
    } catch {
      context.truncated = true
      truncated = true
    }
  }

  ancestors.delete(value)
  return {
    included: true,
    serializedBytes,
    maxStringCharLength,
    maxStringByteLength,
    truncated
  }
}

function createAccumulator(slot: PayloadProfileSlot): SlotAccumulator {
  return {
    slot,
    kinds: new Set(),
    stringTotalBytes: 0,
    stringMaxChars: 0,
    stringMaxBytes: 0,
    bytesTotal: 0,
    bytesMax: 0,
    jsonTotalBytes: 0,
    jsonMaxBytes: 0,
    jsonMaxStringChars: 0,
    jsonMaxStringBytes: 0,
    truncated: false
  }
}

function finalizeSlot(accumulator: SlotAccumulator): PayloadLengthSlotProfile {
  if (accumulator.kinds.size === 0) return { slot: accumulator.slot, kind: 'empty' }
  if (accumulator.kinds.size > 1) {
    return { slot: accumulator.slot, kind: 'mixed', traversal: accumulator.truncated ? 'truncated' : 'complete' }
  }

  const [kind] = accumulator.kinds
  switch (kind) {
    case 'string':
      return {
        slot: accumulator.slot,
        kind,
        totalByteLengthBucket: lengthBucket(accumulator.stringTotalBytes),
        maxCharLengthBucket: lengthBucket(accumulator.stringMaxChars),
        maxByteLengthBucket: lengthBucket(accumulator.stringMaxBytes)
      }
    case 'bytes':
      return {
        slot: accumulator.slot,
        kind,
        totalByteLengthBucket: lengthBucket(accumulator.bytesTotal),
        maxByteLengthBucket: lengthBucket(accumulator.bytesMax)
      }
    case 'json':
      return {
        slot: accumulator.slot,
        kind,
        totalSerializedByteLengthBucket: lengthBucket(accumulator.jsonTotalBytes),
        maxSerializedByteLengthBucket: lengthBucket(accumulator.jsonMaxBytes),
        maxStringLeafCharLengthBucket: lengthBucket(accumulator.jsonMaxStringChars),
        maxStringLeafByteLengthBucket: lengthBucket(accumulator.jsonMaxStringBytes),
        traversal: accumulator.truncated ? 'truncated' : 'complete'
      }
    case 'unsupported':
      return { slot: accumulator.slot, kind }
  }
}

function descriptorSlots(descriptor: PayloadProfileDescriptor, context: TraversalContext): PayloadProfileSlot[] {
  if (!payloadTargetSet.has(descriptor.target)) throw new TypeError('Unsupported payload profile target')
  if (descriptor.fields.length > MAX_DESCRIPTOR_FIELDS) context.truncated = true

  const slots: PayloadProfileSlot[] = []
  const seen = new Set<PayloadProfileSlot>()
  for (const field of descriptor.fields.slice(0, MAX_DESCRIPTOR_FIELDS)) {
    if (!payloadSlotSet.has(field)) {
      context.truncated = true
      continue
    }
    if (!seen.has(field)) {
      seen.add(field)
      slots.push(field)
    }
  }
  return slots
}

export function profilePayloadLengths(
  rows: readonly unknown[],
  descriptor: PayloadProfileDescriptor
): PayloadLengthProfile {
  const context: TraversalContext = {
    deadline: performance.now() + DEADLINE_MS,
    nodes: 0,
    truncated: false
  }
  const slots = descriptorSlots(descriptor, context)
  const accumulators = slots.map(createAccumulator)
  let profiledBytes = 0
  let maxProfiledRowBytes = 0

  for (const row of rows) {
    if (deadlineExceeded(context)) break
    let rowBytes = 0
    let stopAfterRow = false

    if (row === null || row === undefined) continue
    if (!isObjectLike(row) || isArray(row) || !isPlainObject(row)) {
      for (const accumulator of accumulators) accumulator.kinds.add('unsupported')
      continue
    }

    for (const accumulator of accumulators) {
      if (deadlineExceeded(context)) {
        stopAfterRow = true
        break
      }
      const descriptor = ownDataDescriptor(row, accumulator.slot)
      if (!descriptor || descriptor.value === null || descriptor.value === undefined) continue
      const value = descriptor.value
      const byteLength = uint8ArrayByteLength(value)
      let fieldBytes = 0

      if (typeof value === 'string') {
        accumulator.kinds.add('string')
        const measured = measureUtf8(value, context)
        accumulator.stringTotalBytes = saturatingAdd(accumulator.stringTotalBytes, measured.bytes)
        accumulator.stringMaxChars = Math.max(accumulator.stringMaxChars, Math.min(LENGTH_SATURATION, value.length))
        accumulator.stringMaxBytes = Math.max(accumulator.stringMaxBytes, measured.bytes)
        accumulator.truncated ||= !measured.complete
        fieldBytes = measured.bytes
      } else if (byteLength !== undefined) {
        accumulator.kinds.add('bytes')
        const bytes = Math.min(LENGTH_SATURATION, byteLength)
        accumulator.bytesTotal = saturatingAdd(accumulator.bytesTotal, bytes)
        accumulator.bytesMax = Math.max(accumulator.bytesMax, bytes)
        fieldBytes = bytes
      } else if (isArray(value) || (isObjectLike(value) && isPlainObject(value))) {
        accumulator.kinds.add('json')
        const measured = measureJson(value, 0, new Set(), context)
        accumulator.jsonTotalBytes = saturatingAdd(accumulator.jsonTotalBytes, measured.serializedBytes)
        accumulator.jsonMaxBytes = Math.max(accumulator.jsonMaxBytes, measured.serializedBytes)
        accumulator.jsonMaxStringChars = Math.max(accumulator.jsonMaxStringChars, measured.maxStringCharLength)
        accumulator.jsonMaxStringBytes = Math.max(accumulator.jsonMaxStringBytes, measured.maxStringByteLength)
        accumulator.truncated ||= measured.truncated
        fieldBytes = measured.serializedBytes
      } else {
        accumulator.kinds.add('unsupported')
      }

      rowBytes = saturatingAdd(rowBytes, fieldBytes)
      if (context.truncated && deadlineExceeded(context)) {
        stopAfterRow = true
        break
      }
    }

    profiledBytes = saturatingAdd(profiledBytes, rowBytes)
    maxProfiledRowBytes = Math.max(maxProfiledRowBytes, rowBytes)
    if (stopAfterRow) break
  }

  return {
    target: descriptor.target,
    rowCountBucket: rowCountBucket(rows.length),
    profiledByteLengthBucket: lengthBucket(profiledBytes),
    maxProfiledRowByteLengthBucket: lengthBucket(maxProfiledRowBytes),
    traversal: context.truncated ? 'truncated' : 'complete',
    slots: accumulators.map(finalizeSlot)
  }
}
