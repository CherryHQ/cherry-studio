// Adapted from T3 Code, copyright (c) 2026 T3 Tools Inc. (MIT).
// Provenance and license: resources/terminal/ghostty/README.md.

export interface GhosttyRuntimeOptions {
  wasm: Uint8Array<ArrayBuffer>
  writePtyWasm: Uint8Array<ArrayBuffer>
  revision: string
  onLog: (message: string) => void
}

type WasmFunction = (...args: Array<number | bigint>) => number

interface TypeField {
  readonly offset: number
  readonly size: number
  readonly type: string
}

interface TypeLayout {
  readonly size: number
  readonly align: number
  readonly fields: Readonly<Record<string, TypeField>>
}

type TypeLayouts = Readonly<Record<string, TypeLayout>>

const textDecoder = new TextDecoder()

export class GhosttyRuntime {
  readonly memory: WebAssembly.Memory
  readonly layouts: TypeLayouts
  private readonly exports: WebAssembly.Exports
  private memoryView: DataView
  private memoryU8: Uint8Array
  private readonly ptyWriters = new Map<number, (data: string) => void>()
  private nextPtyWriterId = 1
  private writePtyFunctionIndex = 0

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
    this.layouts = JSON.parse(textDecoder.decode(bytes.subarray(jsonPointer, end))) as TypeLayouts
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
    await runtime.installWritePtyTrampoline(options.writePtyWasm)
    return runtime
  }

  private assertRevision(expected: string): void {
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
    const layout = this.layouts[name]
    if (!layout) throw new Error(`libghostty-vt type layout is unavailable: ${name}`)
    return layout
  }

  alloc(size: number): number {
    const pointer = this.call('ghostty_wasm_alloc_u8_array', size)
    if (pointer === 0) throw new Error(`libghostty-vt failed to allocate ${size} bytes`)
    new Uint8Array(this.memory.buffer, pointer, size).fill(0)
    return pointer
  }

  free(pointer: number, size: number): void {
    if (pointer !== 0) this.call('ghostty_wasm_free_u8_array', pointer, size)
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
    this.call('ghostty_terminal_set', terminal, 0, id)
    this.call('ghostty_terminal_set', terminal, 1, this.writePtyFunctionIndex)
    return id
  }

  detachPtyWriter(terminal: number, id: number): void {
    this.call('ghostty_terminal_set', terminal, 1, 0)
    this.call('ghostty_terminal_set', terminal, 0, 0)
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
    switch (field.type) {
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
    switch (field.type) {
      case 'bool':
      case 'u8':
        return view.getUint8(offset)
      case 'u16':
        return view.getUint16(offset, true)
      case 'i32':
        return view.getInt32(offset, true)
      case 'u32':
      case 'enum':
        return view.getUint32(offset, true)
      case 'u64':
        return Number(view.getBigUint64(offset, true))
      default:
        throw new Error(`Unsupported libghostty-vt field type: ${field.type}`)
    }
  }

  private async installWritePtyTrampoline(wasm: Uint8Array<ArrayBuffer>): Promise<void> {
    const result = await WebAssembly.instantiate(wasm, {
      env: {
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
  }
}
