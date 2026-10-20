import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { EvalFlags, JSException, QuickJS } from 'quickjs-wasi'

import { type UtilityProcessHandlerContext } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import type { AutomationContext, AutomationKernelContract } from '../contracts'
import { AutomationBindings } from './AutomationBindings'

export class AutomationKernel {
  private vm: QuickJS | undefined
  private current: UtilityProcessHandlerContext<never> | undefined
  private deadline = 0
  private output = ''
  private outputTruncated = false
  private bootstrap: string | undefined
  private admitting = false
  private bindings: AutomationBindings | undefined
  private generation: string | null = null
  private execution: AutomationContext['execution'] = 'not-started'
  private hostCallsStarted = 0
  private readonly calls = new Set<Promise<void>>()

  private append(value: string): void {
    const next = this.output + value + '\n'
    this.outputTruncated ||= next.length > 48_000
    this.output = next.slice(0, 48_000)
  }

  private async initialize(bootstrap: string): Promise<QuickJS> {
    const runtime = await QuickJS.create({
      wasm: await readFile(require.resolve('quickjs-wasi/quickjs.wasm')),
      memoryLimit: 32 * 1024 * 1024,
      interruptHandler: () => Date.now() >= this.deadline || this.current?.signal.aborted === true,
      moduleLoader: {
        load: () => {
          throw new Error('Module imports are unavailable in Automation REPL')
        }
      }
    })
    using hostCall = runtime.newFunction('__hostCall', (method, input) => {
      if (!this.current || !this.admitting) throw new Error('No active execution')
      const serialized = input.toString()
      if (serialized.length > 256_000) throw new Error('Automation input exceeds 256 KB')
      const deferred = runtime.newPromise()
      const context = this.current
      this.hostCallsStarted++
      const operation = context.callHost(method.toString(), JSON.parse(serialized))
      const tracked = operation
        .then(
          (value) => {
            const serialized = JSON.stringify(value)
            if (serialized.length > 256_000) {
              using error = runtime.newError('Observation exceeds 256 KB; narrow the next observation')
              deferred.reject(error)
              return
            }
            using result = runtime.newString(serialized)
            deferred.resolve(result)
          },
          (error) => {
            using result = runtime.newError(error instanceof Error ? error.message : String(error))
            deferred.reject(result)
          }
        )
        .then(() => {
          runtime.executePendingJobs()
        })
        .finally(() => {
          this.calls.delete(tracked)
        })
      this.calls.add(tracked)
      void tracked.catch(() => {})
      return deferred.handle
    })
    using print = runtime.newFunction('__print', (value) => {
      this.append(value.toString())
      return runtime.undefined
    })
    runtime.setProp(runtime.global, '__hostCall', hostCall)
    runtime.setProp(runtime.global, '__print', print)
    try {
      runtime.evalCode(bootstrap).dispose()
      this.bindings = new AutomationBindings(runtime)
      this.generation = randomUUID()
      return runtime
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof JSException) error.dispose()
      runtime.dispose()
      throw new Error(message)
    }
  }

  private result(isError?: boolean): AutomationKernelContract['methods']['execute']['output'] {
    const bindings = this.vm && this.bindings ? this.bindings.inspect(this.vm) : { bindings: [], truncated: false }
    if (this.vm) {
      this.current?.signal.throwIfAborted()
      if (Date.now() >= this.deadline) throw new Error('REPL execution timed out')
    }
    return {
      text:
        this.output +
        (this.outputTruncated ? '\nREPL output was OMITTED after 48,000 characters; request a smaller result.\n' : ''),
      ...(isError ? { isError } : {}),
      context: {
        generation: this.generation,
        state: this.vm ? 'retained' : 'cleared',
        execution: this.execution,
        hostCallsStarted: this.hostCallsStarted,
        ...bindings
      }
    }
  }

  async execute(
    { code, bootstrap }: AutomationKernelContract['methods']['execute']['input'],
    context: UtilityProcessHandlerContext<never>
  ): Promise<AutomationKernelContract['methods']['execute']['output']> {
    if (this.current) throw new Error('REPL is already executing')
    this.current = context
    this.admitting = true
    this.deadline = Date.now() + 60_000
    this.output = ''
    this.outputTruncated = false
    this.execution = 'not-started'
    this.hostCallsStarted = 0
    try {
      if (this.vm && this.bootstrap !== bootstrap) {
        this.dispose()
        this.append('Automation API changed; old bindings were cleared. Bind targets again; no actions were replayed.')
      }
      this.vm ??= await this.initialize(bootstrap)
      this.bootstrap = bootstrap
      const enteredName = `__replEntered_${randomUUID().replaceAll('-', '')}`
      let prepared: ReturnType<AutomationBindings['prepare']>
      try {
        prepared = this.bindings!.prepare(code, enteredName)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        this.append(`SyntaxError: ${error.message}`)
        return this.result(true)
      }
      using entered = this.vm.newEphemeralFunction(() => {
        if (this.execution === 'not-started') {
          prepared.entered()
          this.execution = 'started'
        }
        return this.vm!.undefined
      })
      this.vm.global.setProp(enteredName, entered)
      using promise = this.vm.evalCode(prepared.code, 'automation-cell.js', EvalFlags.ASYNC)
      const resolved = this.vm.resolvePromise(promise)
      this.vm.executePendingJobs()
      const result = await resolved
      this.vm.evalCode(`delete ${enteredName}`).dispose()
      if ('error' in result) this.admitting = false
      while (this.calls.size) await Promise.all([...this.calls])
      this.admitting = false
      if ('error' in result) {
        using error = result.error
        this.append(error.toString())
        this.vm.executePendingJobs()
        return this.result(true)
      }
      using completion = result.value
      using value = completion.getProp('value')
      using stringify = this.vm.evalCode(
        `(value) => {
          const seen = new WeakSet();
          return typeof value === "string" ? value : JSON.stringify(value, (_key, item) => {
            if (typeof item === "bigint") return String(item);
            if (item && typeof item === "object") {
              if (seen.has(item)) return "[Circular]";
              seen.add(item);
            }
            return item;
          }) ?? String(value);
        }`
      )
      try {
        using rendered = this.vm.callFunction(stringify, this.vm.undefined, value)
        this.append(rendered.toString())
      } catch (error) {
        if (!(error instanceof JSException) || context.signal.aborted || Date.now() >= this.deadline) throw error
        try {
          this.append(`Result formatting failed: ${error.message}`)
        } finally {
          error.dispose()
        }
        this.vm.executePendingJobs()
        return this.result(true)
      }
      this.vm.executePendingJobs()
      this.execution = 'completed'
      return this.result()
    } catch (error) {
      this.admitting = false
      // A failed execution must not leave work that could resume in a later cell.
      while (this.calls.size) await Promise.allSettled([...this.calls])
      this.append(
        `REPL state was cleared; no actions were replayed. ${error instanceof Error ? error.message : String(error)}`
      )
      if (error instanceof JSException) error.dispose()
      this.dispose()
      this.execution = 'interrupted'
      return this.result(true)
    } finally {
      this.admitting = false
      this.current = undefined
    }
  }

  dispose(): void {
    this.vm?.dispose()
    this.vm = undefined
    this.bindings = undefined
    this.generation = null
    this.bootstrap = undefined
  }
}
