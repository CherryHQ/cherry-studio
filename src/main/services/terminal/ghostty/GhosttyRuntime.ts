// Adapted from T3 Code, copyright (c) 2026 T3 Tools Inc. (MIT).
// Provenance and license: resources/terminal/ghostty/README.md.

import * as z from 'zod'

export interface GhosttyRuntimeOptions {
  wasm: Uint8Array<ArrayBuffer>
  writePtyWasm: Uint8Array<ArrayBuffer>
  revision: string
  onLog: (message: string) => void
}

type WasmFunction = (...args: Array<number | bigint>) => number

const typeLayoutSchema = z.object({
  size: z.number().int().nonnegative(),
  align: z.number().int().positive(),
  fields: z.record(
    z.string(),
    z.object({ offset: z.number().int().nonnegative(), size: z.number().int().nonnegative(), type: z.string() })
  )
})
const enumSchema = z.object({
  kind: z.literal('enum'),
  underlying: z.string(),
  values: z.record(z.string(), z.number().int())
})
const aliasSchema = z.object({ kind: z.literal('alias'), type: z.string() })
const abiSchema = z.object({
  schema: z.literal(1),
  abi: z.object({
    target: z.literal('wasm32'),
    pointer_size: z.literal(4),
    usize_size: z.literal(4),
    endian: z.literal('little')
  }),
  commit: z.string(),
  dirty: z.literal(false).nullable(),
  types: z.record(z.string(), z.unknown())
})
type TypeLayout = z.infer<typeof typeLayoutSchema>

export class GhosttySearchCapacityError extends Error {
  constructor() {
    super('libghostty-vt search allocation budget exceeded')
  }
}

export interface GhosttyAllocationBudget {
  readonly pointer: number
  readonly size: number
  readonly id: number
  readonly limit: number
  used: number
  exhausted: boolean
  readonly allocations: Map<number, { base: number; size: number }>
}

const textDecoder = new TextDecoder()

export class GhosttyRuntime {
  readonly memory: WebAssembly.Memory
  private readonly abi: z.infer<typeof abiSchema>
  private readonly layouts = new Map<string, TypeLayout>()
  private readonly enums = new Map<string, z.infer<typeof enumSchema>>()
  private readonly exports: WebAssembly.Exports
  private memoryView: DataView
  private memoryU8: Uint8Array
  private readonly ptyWriters = new Map<number, (data: string) => void>()
  private nextPtyWriterId = 1
  private writePtyFunctionIndex = 0
  private allocatorFunctionIndex = 0
  private freeFunctionIndex = 0
  private readonly budgets = new Map<number, GhosttyAllocationBudget>()
  private nextBudgetId = 1
  private budgetBytes = 0

  private constructor(instance: WebAssembly.Instance) {
    this.exports = instance.exports
    const memory = instance.exports.memory
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error('libghostty-vt did not export WebAssembly memory')
    }
    this.memory = memory
    this.memoryView = new DataView(memory.buffer)
    this.memoryU8 = new Uint8Array(memory.buffer)
    const jsonPointer = this.call('ghostty_type_json')
    const bytes = new Uint8Array(memory.buffer)
    let end = jsonPointer
    while (end < bytes.length && bytes[end] !== 0) end += 1
    this.abi = abiSchema.parse(JSON.parse(textDecoder.decode(bytes.subarray(jsonPointer, end))))
  }

  static async create(options: GhosttyRuntimeOptions): Promise<GhosttyRuntime> {
    const state: { instance?: WebAssembly.Instance } = {}
    const imports = {
      env: {
        log: (pointer: number, length: number) => {
          if (!state.instance) return
          const memory = state.instance.exports.memory
          if (!(memory instanceof WebAssembly.Memory)) return
          const message = textDecoder.decode(new Uint8Array(memory.buffer, pointer, length))
          options.onLog(message)
        }
      }
    }
    const result = await WebAssembly.instantiate(options.wasm, imports)
    state.instance = result.instance
    const runtime = new GhosttyRuntime(result.instance)
    runtime.assertRevision(options.revision)
    runtime.assertCapabilities()
    await runtime.installWritePtyTrampoline(options.writePtyWasm)
    return runtime
  }

  private assertCapabilities(): void {
    const slot = this.alloc(4)
    try {
      for (const feature of [
        'FORMATTER',
        'SELECTION',
        'SEARCH',
        'RENDER_STATE',
        'INPUT_ENCODE',
        'COLOR',
        'GRID_INTROSPECTION'
      ]) {
        this.bytes(slot, 4).fill(0)
        const key = this.enumValue('GhosttyBuildInfo', `FEATURE_${feature}`)
        if (this.call('ghostty_build_info', key, slot) !== 0 || this.bytes(slot, 1)[0] !== 1)
          throw new Error(`libghostty-vt capability is unavailable: ${feature}`)
      }
      for (const name of [
        'ghostty_search_new',
        'ghostty_search_set',
        'ghostty_search_feed',
        'ghostty_search_tick',
        'ghostty_search_get',
        'ghostty_search_free'
      ])
        this.fn(name)
    } finally {
      this.free(slot, 4)
    }
  }

  createBudget(limit: number): GhosttyAllocationBudget {
    const allocator = this.layout('GhosttyAllocator')
    const vtable = this.layout('GhosttyAllocatorVtable')
    const offset = Math.ceil(allocator.size / vtable.align) * vtable.align
    const size = offset + vtable.size
    if (size > limit || size > 16 * 1024 * 1024 - this.budgetBytes) throw new GhosttySearchCapacityError()
    const pointer = this.alloc(size)
    const budget: GhosttyAllocationBudget = {
      pointer,
      size,
      id: this.nextBudgetId++,
      limit,
      used: size,
      exhausted: false,
      allocations: new Map()
    }
    const view = this.view(pointer, size)
    view.setUint32(allocator.fields.ctx.offset, budget.id, true)
    view.setUint32(allocator.fields.vtable.offset, pointer + offset, true)
    view.setUint32(offset + vtable.fields.alloc.offset, this.allocatorFunctionIndex, true)
    view.setUint32(offset + vtable.fields.free.offset, this.freeFunctionIndex, true)
    this.budgets.set(budget.id, budget)
    this.budgetBytes += size
    return budget
  }

  reserveBudget(budget: GhosttyAllocationBudget, size: number): void {
    if (size > budget.limit - budget.used || size > 16 * 1024 * 1024 - this.budgetBytes)
      throw new GhosttySearchCapacityError()
    budget.used += size
    this.budgetBytes += size
  }

  releaseBudget(budget: GhosttyAllocationBudget): void {
    for (const { base, size } of budget.allocations.values()) this.free(base, size)
    this.budgetBytes -= budget.used
    budget.allocations.clear()
    budget.used = 0
    this.budgets.delete(budget.id)
    this.free(budget.pointer, budget.size)
  }

  allocBudget(budget: GhosttyAllocationBudget, size: number): number {
    const pointer = this.budgetAlloc(budget.id, size, 4)
    if (!pointer) throw new GhosttySearchCapacityError()
    this.bytes(pointer, size).fill(0)
    return pointer
  }

  freeBudget(budget: GhosttyAllocationBudget, pointer: number): void {
    if (pointer) this.budgetFree(budget.id, pointer)
  }

  private budgetAlloc(id: number, length: number, alignment: number): number {
    const budget = this.budgets.get(id)
    if (!budget) throw new Error('Unknown terminal search allocator')
    const align = 2 ** alignment
    const size = length + Math.max(0, align - 16)
    if (budget.exhausted || size > budget.limit - budget.used || size > 16 * 1024 * 1024 - this.budgetBytes) {
      budget.exhausted = true
      return 0
    }
    const base = this.call('ghostty_wasm_alloc', size)
    if (!base) {
      budget.exhausted = true
      return 0
    }
    const pointer = Math.ceil(base / align) * align
    budget.allocations.set(pointer, { base, size })
    budget.used += size
    this.budgetBytes += size
    return pointer
  }

  private budgetFree(id: number, pointer: number): void {
    const budget = this.budgets.get(id)
    const allocation = budget?.allocations.get(pointer)
    if (!budget || !allocation) throw new Error('Unknown terminal search allocation')
    this.free(allocation.base, allocation.size)
    budget.allocations.delete(pointer)
    budget.used -= allocation.size
    this.budgetBytes -= allocation.size
  }

  private assertRevision(expected: string): void {
    if (this.abi.commit !== expected)
      throw new Error(`libghostty-vt revision mismatch: expected ${expected}, got ${this.abi.commit}`)
    const slot = this.alloc(8)
    try {
      if (this.call('ghostty_build_info', 10, slot) !== 0) throw new Error('libghostty-vt build info is unavailable')
      const pointer = this.view(slot).getUint32(0, true)
      const length = this.view(slot).getUint32(4, true)
      const actual = textDecoder.decode(this.bytes(pointer, length))
      if (actual !== expected) throw new Error(`libghostty-vt revision mismatch: expected ${expected}, got ${actual}`)
    } finally {
      this.free(slot, 8)
    }
  }

  call(name: string, ...args: Array<number | bigint>): number {
    return this.fn(name)(...args)
  }

  fn(name: string): WasmFunction {
    const fn = this.exports[name]
    if (typeof fn !== 'function') {
      throw new Error(`libghostty-vt export is unavailable: ${name}`)
    }
    return fn as WasmFunction
  }

  layout(name: string): TypeLayout {
    const cached = this.layouts.get(name)
    if (cached) return cached
    const result = typeLayoutSchema.safeParse(this.abi.types[name])
    if (!result.success) throw new Error(`libghostty-vt type layout is unavailable: ${name}`)
    const layout = result.data
    this.layouts.set(name, layout)
    return layout
  }

  enumValue(type: string, name: string): number {
    let definition = this.enums.get(type)
    if (!definition) {
      definition = enumSchema.parse(this.abi.types[type])
      this.enums.set(type, definition)
    }
    const value = definition.values[name]
    if (value === undefined) throw new Error(`libghostty-vt enum is unavailable: ${type}.${name}`)
    return value
  }

  alloc(size: number): number {
    const pointer = this.call('ghostty_wasm_alloc', size)
    if (pointer === 0) throw new Error(`libghostty-vt failed to allocate ${size} bytes`)
    new Uint8Array(this.memory.buffer, pointer, size).fill(0)
    return pointer
  }

  free(pointer: number, size: number): void {
    if (pointer !== 0) this.call('ghostty_wasm_free', pointer, size)
  }

  allocOpaque(): number {
    const pointer = this.call('ghostty_wasm_alloc_opaque')
    if (pointer === 0) throw new Error('libghostty-vt failed to allocate an opaque pointer')
    // Zero before *_new so partial-initialization cleanup cannot free a garbage pointer.
    new DataView(this.memory.buffer).setUint32(pointer, 0, true)
    return pointer
  }

  freeOpaque(pointer: number): void {
    if (pointer !== 0) this.call('ghostty_wasm_free_opaque', pointer)
  }

  readPointer(slot: number): number {
    return this.memoryDataView().getUint32(slot, true)
  }

  attachPtyWriter(terminal: number, writer: (data: string) => void): number {
    if (this.writePtyFunctionIndex === 0) {
      throw new Error('libghostty-vt PTY callback trampoline is unavailable')
    }
    const id = this.nextPtyWriterId++
    this.ptyWriters.set(id, writer)
    this.call('ghostty_terminal_set', terminal, this.enumValue('GhosttyTerminalOption', 'USERDATA'), id)
    this.call(
      'ghostty_terminal_set',
      terminal,
      this.enumValue('GhosttyTerminalOption', 'WRITE_PTY'),
      this.writePtyFunctionIndex
    )
    return id
  }

  detachPtyWriter(terminal: number, id: number): void {
    this.call('ghostty_terminal_set', terminal, this.enumValue('GhosttyTerminalOption', 'WRITE_PTY'), 0)
    this.call('ghostty_terminal_set', terminal, this.enumValue('GhosttyTerminalOption', 'USERDATA'), 0)
    this.ptyWriters.delete(id)
  }

  view(pointer: number, size?: number): DataView {
    return new DataView(this.memoryDataView().buffer, pointer, size)
  }

  bytes(pointer: number, size: number): Uint8Array {
    return new Uint8Array(this.memoryDataView().buffer, pointer, size)
  }

  memoryDataView(): DataView {
    this.refreshMemoryViews()
    return this.memoryView
  }

  memoryBytes(): Uint8Array {
    this.refreshMemoryViews()
    return this.memoryU8
  }

  private refreshMemoryViews(): void {
    // Growing memory detaches the old buffer. Reading `memory.buffer` costs far more than this check.
    if (this.memoryU8.byteLength === 0) {
      this.memoryView = new DataView(this.memory.buffer)
      this.memoryU8 = new Uint8Array(this.memory.buffer)
    }
  }

  setField(pointer: number, structName: string, fieldName: string, value: number): void {
    const field = this.layout(structName).fields[fieldName]
    if (!field) throw new Error(`libghostty-vt field is unavailable: ${structName}.${fieldName}`)
    const view = this.memoryDataView()
    const offset = pointer + field.offset
    const type = this.scalarType(field.type)
    switch (type) {
      case 'bool':
      case 'u8':
        view.setUint8(offset, value)
        return
      case 'u16':
        view.setUint16(offset, value, true)
        return
      case 'i32':
        view.setInt32(offset, value, true)
        return
      case 'u32':
      case 'pointer':
      case 'enum':
        view.setUint32(offset, value, true)
        return
      case 'u64':
        view.setBigUint64(offset, BigInt(value), true)
        return
      default:
        throw new Error(`Unsupported libghostty-vt field type: ${field.type}`)
    }
  }

  readField(pointer: number, structName: string, fieldName: string): number {
    const field = this.layout(structName).fields[fieldName]
    if (!field) throw new Error(`libghostty-vt field is unavailable: ${structName}.${fieldName}`)
    const view = this.memoryDataView()
    const offset = pointer + field.offset
    const type = this.scalarType(field.type)
    switch (type) {
      case 'bool':
      case 'u8':
        return view.getUint8(offset)
      case 'u16':
        return view.getUint16(offset, true)
      case 'i32':
        return view.getInt32(offset, true)
      case 'u32':
      case 'pointer':
      case 'enum':
        return view.getUint32(offset, true)
      case 'u64':
        return Number(view.getBigUint64(offset, true))
      default:
        throw new Error(`Unsupported libghostty-vt field type: ${field.type}`)
    }
  }

  private scalarType(name: string): string {
    if (!name.startsWith('Ghostty')) return name
    const alias = aliasSchema.safeParse(this.abi.types[name])
    return alias.success ? alias.data.type : enumSchema.parse(this.abi.types[name]).underlying
  }

  private async installWritePtyTrampoline(wasm: Uint8Array<ArrayBuffer>): Promise<void> {
    const result = await WebAssembly.instantiate(wasm, {
      env: {
        cherry_alloc: (id: number, length: number, alignment: number) => this.budgetAlloc(id, length, alignment),
        cherry_free: (id: number, pointer: number) => this.budgetFree(id, pointer),
        t3_write_pty: (_terminal: number, userdata: number, pointer: number, length: number) => {
          const writer = this.ptyWriters.get(userdata)
          if (!writer || length === 0) return
          writer(textDecoder.decode(new Uint8Array(this.memory.buffer, pointer, length)))
        }
      }
    })
    const trampoline = result.instance.exports.ghostty_write_pty
    const table = this.exports.__indirect_function_table
    if (typeof trampoline !== 'function' || !(table instanceof WebAssembly.Table)) {
      throw new Error('libghostty-vt did not expose its callback table')
    }
    const index = table.length
    // WebKit grow(1, fn) stores broken type info and traps on call_indirect; table.set canonicalizes it.
    table.grow(1)
    table.set(index, trampoline)
    this.writePtyFunctionIndex = index
    for (const [name, assign] of [
      [
        'ghostty_allocator_alloc',
        (value: number) => {
          this.allocatorFunctionIndex = value
        }
      ],
      [
        'ghostty_allocator_free',
        (value: number) => {
          this.freeFunctionIndex = value
        }
      ]
    ] as const) {
      const callback = result.instance.exports[name]
      if (typeof callback !== 'function') throw new Error(`libghostty-vt allocator callback is unavailable: ${name}`)
      const slot = table.length
      table.grow(1)
      table.set(slot, callback)
      assign(slot)
    }
  }
}
