/**
 * Contract for the main-build chunk guard: reading a member the target chunk never
 * exports must fail the build, and both real export forms rolldown emits must pass.
 *
 * CI does not run `electron-vite build`, so without this the guard's regexes can rot
 * against a rolldown output change and every check still goes green.
 */
import { describe, expect, it } from 'vitest'

import { chunkExportGuardPlugin } from '../checkChunkExports'

const FACADE = `const require_target = require("./target.js");
exports.createOpenAI = require_target.createOpenAI;`

/** What rolldown emitted for the merged facade chunk: only an unrelated `default`. */
const TARGET_WITHOUT_EXPORT = `const require_main = require("./main.js");
Object.defineProperty(exports, "default", {
	enumerable: true,
	get: function() {
		return require_main.require_token_util();
	}
});`

const run = (bundle: Record<string, string>) => {
  const plugin = chunkExportGuardPlugin()
  const hook = plugin.generateBundle as (
    this: { error: (message: string) => never },
    options: unknown,
    bundle: unknown
  ) => void
  hook.call(
    {
      error: (message) => {
        throw new Error(message)
      }
    },
    {},
    Object.fromEntries(Object.entries(bundle).map(([fileName, code]) => [fileName, { type: 'chunk', code }]))
  )
}

describe('chunkExportGuardPlugin', () => {
  it('fails when a chunk reads a member its target never exports', () => {
    expect(() => run({ 'facade.js': FACADE, 'target.js': TARGET_WITHOUT_EXPORT })).toThrow(
      'facade.js reads "createOpenAI" from target.js, which does not export it'
    )
  })

  it('passes when the target assigns the member onto exports', () => {
    expect(() =>
      run({ 'facade.js': FACADE, 'target.js': 'function createOpenAI() {}\nexports.createOpenAI = createOpenAI;' })
    ).not.toThrow()
  })

  it('passes when the target defines the member as an exports getter', () => {
    expect(() =>
      run({
        'facade.js': FACADE,
        'target.js': 'Object.defineProperty(exports, "createOpenAI", { get: function() { return null; } });'
      })
    ).not.toThrow()
  })
})
