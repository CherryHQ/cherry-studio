/**
 * Shared `?asset` mock setup for bash parser tests.
 *
 * `?asset` is rewritten by electron-vite at build time. Vitest doesn't
 * run that transform, so any test that transitively imports
 * `bash/parser.ts` must mock the import — point it at the real WASM in
 * `node_modules/tree-sitter-bash/`. Import this file at the top of the
 * test (must come BEFORE any import that pulls in `parser.ts`).
 *
 * The `vi.hoisted` block ensures the path resolves before vitest hoists
 * the `vi.mock` factory.
 */

import { vi } from 'vitest'

const { realBashWasm } = vi.hoisted(() => {
  const { createRequire } = require('node:module')
  const path = require('node:path')
  return {
    realBashWasm: path.join(
      path.dirname(createRequire(__filename).resolve('tree-sitter-bash/package.json')),
      'tree-sitter-bash.wasm'
    )
  }
})

vi.mock('tree-sitter-bash/tree-sitter-bash.wasm?asset', () => ({ default: realBashWasm }))
