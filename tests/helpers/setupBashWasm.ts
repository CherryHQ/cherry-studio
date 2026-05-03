/**
 * Shared `?asset` mock for tests that transitively import the bash AST
 * parser. Vitest doesn't run electron-vite's `?asset` transform, so we
 * point the import at the real WASM in `node_modules/tree-sitter-bash/`.
 *
 * Import this file (no exports needed) at the top of any test file that
 * pulls in `src/main/ai/tools/builtin/shell/bash/parser.ts` directly or
 * via re-export.
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
