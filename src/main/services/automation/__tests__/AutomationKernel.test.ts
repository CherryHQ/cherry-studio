import { afterEach, describe, expect, it } from 'vitest'

import type { UtilityProcessHandlerContext } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { automationBootstrap } from '../bootstrap'
import { AutomationKernel } from '../utilityEntries/AutomationKernel'

const kernels = new Set<AutomationKernel>()
function createKernel() {
  const kernel = new AutomationKernel()
  kernels.add(kernel)
  return kernel
}
const context = (
  callHost: UtilityProcessHandlerContext<never>['callHost'] = async () => null
): UtilityProcessHandlerContext<never> => ({
  signal: new AbortController().signal,
  callHost,
  emit: () => {},
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
})
const bootstrap = 'globalThis.call = async (input) => JSON.parse(await __hostCall("capability", JSON.stringify(input)))'
afterEach(() => {
  for (const kernel of kernels) kernel.dispose()
  kernels.clear()
})

describe('persistent automation kernel', () => {
  it('discards old proxies and bindings when the API bootstrap changes without replaying actions', async () => {
    const kernel = createKernel()
    let effects = 0
    const host = context(async () => ++effects)
    const first = await kernel.execute({ bootstrap, code: 'var oldHandle = await call({})' }, host)
    const second = await kernel.execute({ bootstrap: bootstrap + '\n// API revision', code: 'typeof oldHandle' }, host)
    expect(second.context.generation).not.toBe(first.context.generation)
    expect(second.context.bindings).toEqual([])
    expect(second.text).toContain('old bindings were cleared')
    expect(second.text).toContain('undefined')
    expect(effects).toBe(1)
  })

  it('marks oversized JS output as incomplete', async () => {
    const result = await createKernel().execute({ bootstrap, code: '"x".repeat(50000)' }, context())
    expect(result.text).toContain('output was OMITTED')
    expect(result.text.length).toBeLessThan(49000)
  })

  it('reuses an app handle and preserves structured action failures without replay', async () => {
    const kernel = createKernel()
    let text = ''
    const host = context(async (domain, input) => {
      const request = input as { name: string; args: { text?: string }; target?: string }
      if (domain !== 'computer') throw new Error('Unexpected target domain')
      if (request.name === 'getApp') return { ok: true, value: { target: 'Calculator' } }
      if (request.target !== 'Calculator') throw new Error('Lost app binding')
      if (request.name === 'typeText') {
        text += request.args.text
        return { ok: true, value: { status: 'completed' } }
      }
      return { ok: false, error: { code: 'STALE_SNAPSHOT', effect: 'none', message: 'Window changed' } }
    })
    const bootstrap = automationBootstrap()
    await kernel.execute({ bootstrap, code: 'var app = await computer.getApp("Calculator")' }, host)
    const result = await kernel.execute(
      {
        bootstrap,
        code: 'await app.typeText("128*37+456"); await app.pressKey("Return"); await app.typeText("duplicate")'
      },
      host
    )
    expect(result.isError).toBe(true)
    expect(text).toBe('128*37+456')
    const failure = await kernel.execute(
      {
        bootstrap,
        code: 'var failure; try { await app.pressKey("Return") } catch (error) { failure = {code: error.code, effect: error.effect} }; failure'
      },
      host
    )
    expect(JSON.parse(failure.text)).toEqual({ code: 'STALE_SNAPSHOT', effect: 'none' })
    expect(text).toBe('128*37+456')
  })

  it('retains bindings and functions across awaited cells without replaying earlier host calls', async () => {
    const kernel = createKernel()
    let effects = 0
    const host = context(async () => ++effects)
    expect(
      await kernel.execute(
        { bootstrap, code: 'var count = await call({}); function increment() { return ++count }; count' },
        host
      )
    ).toMatchObject({ text: '1\n' })
    expect(await kernel.execute({ bootstrap, code: 'increment()' }, host)).toMatchObject({ text: '2\n' })
    expect(effects).toBe(1)
  })

  it('does not expose Node or import authority to guest code', async () => {
    const kernel = createKernel()
    expect(
      await kernel.execute(
        { bootstrap, code: '[typeof process, typeof require, typeof fetch, typeof setTimeout]' },
        context()
      )
    ).toMatchObject({ text: '["undefined","undefined","undefined","undefined"]\n' })
    expect(await kernel.execute({ bootstrap, code: 'await import("node:fs")' }, context())).toMatchObject({
      isError: true
    })
  })

  it('drains unawaited host operations before a cell completes', async () => {
    const kernel = createKernel()
    let completed = false
    const result = await kernel.execute(
      { bootstrap, code: 'call({}).then(value => { globalThis.saved = value }); "scheduled"' },
      context(async () => {
        await Promise.resolve()
        completed = true
        return 42
      })
    )
    expect(result.isError).not.toBe(true)
    expect(completed).toBe(true)
    expect(await kernel.execute({ bootstrap, code: 'saved' }, context())).toMatchObject({ text: '42\n' })
  })

  it('does not grant host calls to result formatting or carry its microtasks into a later cell', async () => {
    const kernel = createKernel()
    let effects = 0
    const host = context(async () => ++effects)
    const result = await kernel.execute(
      { bootstrap, code: '({ toJSON() { Promise.resolve().then(() => call({})).catch(() => {}); return "safe" } })' },
      host
    )
    expect(result.text).toContain('safe')
    await kernel.execute({ bootstrap, code: '1' }, host)
    expect(effects).toBe(0)
  })

  it.each([
    '({ get value() { throw new Error("format failed") } })',
    '({ toJSON() { Promise.resolve().then(() => call({})).catch(() => {}); throw new Error("format failed") } })'
  ])('retains bindings after a result formatter throws: %s', async (code) => {
    const kernel = createKernel()
    let effects = 0
    const host = context(async () => ++effects)
    const initial = await kernel.execute({ bootstrap, code: 'var retained = 42' }, host)
    const failed = await kernel.execute({ bootstrap, code }, host)
    expect(failed).toMatchObject({
      isError: true,
      text: expect.stringContaining('format failed'),
      context: { generation: initial.context.generation, state: 'retained', execution: 'started' }
    })
    expect(await kernel.execute({ bootstrap, code: 'retained' }, host)).toMatchObject({ text: '42\n' })
    expect(effects).toBe(0)
  })

  it('reports failed host effects without retrying them', async () => {
    const kernel = createKernel()
    let effects = 0
    const result = await kernel.execute(
      { bootstrap, code: 'await call({})' },
      context(async () => {
        effects++
        throw new Error('Effect outcome unknown')
      })
    )
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Effect outcome unknown')
    expect(effects).toBe(1)
  })

  it('reports reserved uninitialized names without losing usable bindings after a failed cell', async () => {
    const kernel = createKernel()
    const initial = await kernel.execute({ bootstrap, code: 'const saved = 42' }, context())
    const failed = await kernel.execute(
      { bootstrap, code: 'const pending = await call({}); let later = 1' },
      context(async () => {
        throw new Error('Observation failed')
      })
    )
    expect(failed).toMatchObject({
      isError: true,
      context: {
        generation: initial.context.generation,
        state: 'retained',
        execution: 'started',
        hostCallsStarted: 1,
        bindings: expect.arrayContaining([
          {
            name: 'saved',
            kind: 'const',
            declared: true,
            type: 'number',
            readable: true,
            canAssign: false,
            canRedeclare: false
          },
          { name: 'pending', kind: 'const', declared: true, readable: false, canAssign: false, canRedeclare: false },
          { name: 'later', kind: 'let', declared: true, readable: false, canAssign: false, canRedeclare: false }
        ])
      }
    })
    expect(await kernel.execute({ bootstrap, code: 'saved' }, context())).toMatchObject({ text: '42\n' })
  })

  it('does not invent bindings for a rejected declaration or discard the previous context', async () => {
    const kernel = createKernel()
    const initial = await kernel.execute({ bootstrap, code: 'let saved = 42' }, context())
    for (const code of ['let saved = 0; const absent = 1', 'const malformed = ;']) {
      const result = await kernel.execute({ bootstrap, code }, context())
      expect(result).toMatchObject({
        isError: true,
        context: { generation: initial.context.generation, execution: 'not-started' }
      })
      expect(result.context.bindings.map((binding) => binding.name)).toEqual(['saved'])
    }
    expect(await kernel.execute({ bootstrap, code: 'saved' }, context())).toMatchObject({ text: '42\n' })
  })

  it('excludes block locals and inspects descriptors without executing getters', async () => {
    const kernel = createKernel()
    const result = await kernel.execute(
      {
        bootstrap,
        code: `
      let {a: [item]} = {a: [1]}; class Page {};
      { const hidden = 2; }
      var reads = 0;
      Object.defineProperty(globalThis, 'accessor', {get() { reads++; return 1 }});
      undefined;
    `
      },
      context()
    )
    expect(result.context.bindings.map((binding) => binding.name)).toEqual(['item', 'Page', 'reads', 'accessor'])
    expect(result.context.bindings.find((binding) => binding.name === 'accessor')).toMatchObject({
      readable: false,
      canAssign: false
    })
    expect(await kernel.execute({ bootstrap, code: 'reads' }, context())).toMatchObject({ text: '0\n' })
  })

  it('preserves strict directives and completion values while tracking execution entry', async () => {
    const kernel = createKernel()
    expect(await kernel.execute({ bootstrap, code: '"use strict";' }, context())).toMatchObject({
      text: 'use strict\n'
    })
    const failed = await kernel.execute({ bootstrap, code: '"use strict"; undeclared = 1' }, context())
    expect(failed.isError).toBe(true)
    expect(failed.context.bindings).toEqual([])
    expect(await kernel.execute({ bootstrap, code: '#!/usr/bin/env node' }, context())).toMatchObject({
      text: 'undefined\n'
    })
  })
})
