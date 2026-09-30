import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { build } from 'vite'
import { expect, it } from 'vitest'

it('loads the bundled DSH stream adapter and reports usage without a neighboring package manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cherry-dsh-stream-bundle-'))
  const projectRoot = path.resolve(import.meta.dirname, '../..')
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@shared': path.join(projectRoot, 'src/shared') } },
      ssr: { noExternal: true },
      build: {
        ssr: path.join(projectRoot, 'src/main/ai/runtime/dsh/dshStreamAdapter.ts'),
        outDir: root,
        emptyOutDir: false,
        rollupOptions: { output: { format: 'cjs', entryFileNames: 'adapter.cjs' } }
      }
    })
    const script = `
      const assert = require('node:assert/strict');
      const { DshStreamAdapter } = require(${JSON.stringify(path.join(root, 'adapter.cjs'))});
      const recorded = [];
      const adapter = new DshStreamAdapter({ onAssistantUsage: value => recorded.push(value) });
      adapter.handleEvent({ type: 'assistant/attempt', seq: 12, data: {
        turn: 1, step: 1,
        stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 3, outputTokens: 5 } } }]
      } });
      assert.equal(recorded.length, 1);
      assert.deepEqual(recorded[0].usage, { inputTokens: 3, outputTokens: 5 });
    `
    expect(() => execFileSync(process.execPath, ['-e', script], { timeout: 30_000 })).not.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
