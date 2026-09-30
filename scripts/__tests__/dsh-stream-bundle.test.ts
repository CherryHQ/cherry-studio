import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

import { build } from 'vite'
import { expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../tests/__mocks__/MainLoggerService'

it.each(['dshStreamAdapter', 'dshChildFlow'])(
  'loads bundled %s and reports usage without a neighboring package manifest',
  async (entry) => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-dsh-stream-bundle-'))
    const projectRoot = path.resolve(import.meta.dirname, '../..')
    try {
      await build({
        configFile: false,
        logLevel: 'silent',
        resolve: { alias: { '@shared': path.join(projectRoot, 'src/shared') } },
        ssr: { noExternal: true },
        build: {
          ssr: path.join(projectRoot, `src/main/ai/runtime/dsh/${entry}.ts`),
          outDir: root,
          emptyOutDir: false,
          rollupOptions: {
            external: ['@logger'],
            output: { format: 'cjs', entryFileNames: 'adapter.cjs' }
          }
        }
      })
      const filename = path.join(root, 'adapter.cjs')
      const require = createRequire(filename)
      const module = { exports: {} as Record<string, any> }
      runInNewContext(await readFile(filename, 'utf8'), {
        module,
        exports: module.exports,
        __filename: filename,
        __dirname: root,
        require: (specifier: string) =>
          specifier === '@logger' ? { loggerService: mockMainLoggerService } : require(specifier)
      })
      const recordUsage = vi.fn()
      const event = {
        type: 'assistant/attempt',
        seq: 12,
        data: {
          turn: 1,
          step: 1,
          stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 3, outputTokens: 5 } } }]
        }
      }
      if (entry === 'dshStreamAdapter') {
        new module.exports.DshStreamAdapter({ onAssistantUsage: recordUsage }).handleEvent(event)
      } else {
        const coordinator = new module.exports.DshSubagentCoordinator('main', {
          currentTurnToken: () => 1,
          emitFlowChunk: vi.fn(),
          emitTaskEvent: vi.fn(),
          emitTasks: vi.fn(),
          emitWorkState: vi.fn(),
          recordChildUsage: recordUsage
        })
        coordinator.noteMainChunk({
          type: 'tool-input-available',
          toolCallId: 'spawn',
          toolName: 'subagent',
          input: {}
        })
        coordinator.handleSdkSubagentStarted('main', 'child')
        coordinator.handleChildEvent('child', event)
      }
      expect(recordUsage.mock.calls.map(([value]) => value.usage)).toEqual([{ inputTokens: 3, outputTokens: 5 }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
)
