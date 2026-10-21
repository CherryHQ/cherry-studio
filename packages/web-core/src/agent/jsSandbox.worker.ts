// One `js_execute` run in QuickJS, whose only host API is `console`. The Core Worker terminates this Worker
// when the run times out, which also stops a script that never yields.
import { EvalFlags, QuickJS } from 'quickjs-wasi'
import wasmUrl from 'quickjs-wasi/quickjs.wasm?url'

export type JsSandboxResult = { output: string; result?: string } | { output: string; error: string }

const MEMORY_LIMIT = 256 * 1024 * 1024

const format = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2))

self.onmessage = async ({ data: code }: MessageEvent<string>) => {
  const lines: string[] = []
  const vm = await QuickJS.create({
    wasm: await WebAssembly.compileStreaming(fetch(wasmUrl)),
    memoryLimit: MEMORY_LIMIT
  })
  const console = vm.newObject()
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const print = vm.newFunction(level, (...args) => {
      lines.push(args.map((arg) => format(vm.dump(arg))).join(' '))
      return vm.undefined
    })
    vm.setProp(console, level, print)
    print.dispose()
  }
  vm.setProp(vm.global, 'console', console)
  console.dispose()

  // `ASYNC` allows top-level `await`; the promise settles to `{ value }`, the script's completion value.
  const completion = vm.evalCode(code, 'script.js', EvalFlags.ASYNC)
  vm.executePendingJobs()
  const settled = await vm.resolvePromise(completion)
  const output = lines.join('\n')
  if ('error' in settled) {
    self.postMessage({ output, error: settled.error.toString() } satisfies JsSandboxResult)
    return
  }
  const { value } = vm.dump(settled.value) as { value: unknown }
  self.postMessage({ output, ...(value !== undefined && { result: format(value) }) } satisfies JsSandboxResult)
}
