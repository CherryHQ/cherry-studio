import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInContext } from 'node:vm'

import { PreloadConfigFactory } from 'electron-vite'
import { JSDOM } from 'jsdom'
import { build } from 'vite'
import { expect, it } from 'vitest'

import config from '../../electron.vite.config'
import { WEBVIEW_ANNOTATION_BRIDGE_CHANNEL } from '../../src/shared/types/webviewAnnotation'

it('starts the built website annotation bridge with only sandbox-permitted modules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cherry-preload-'))
  const dom = new JSDOM('<!doctype html><title>Annotation contract</title>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  })
  try {
    const preload = await new PreloadConfigFactory(
      { ...config.preload!, build: { ...config.preload!.build, outDir: directory } },
      { configFile: false, logLevel: 'silent' },
      {}
    ).build()
    await build(preload)
    const listeners = new Map<string, (event: unknown, command: unknown) => void>()
    const replies: unknown[] = []
    const context = dom.getInternalVMContext()
    context.require = (id: string) => {
      if (id !== 'electron') throw new Error(`Sandbox cannot load ${id}`)
      return {
        ipcRenderer: {
          on: (channel: string, listener: (event: unknown, command: unknown) => void) =>
            listeners.set(channel, listener),
          sendToHost: (channel: string, value: unknown) => {
            if (channel === WEBVIEW_ANNOTATION_BRIDGE_CHANNEL) replies.push(value)
          }
        }
      }
    }
    runInContext(await readFile(join(directory, 'webview.js'), 'utf8'), context)
    listeners.get(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL)?.(
      {},
      {
        type: 'start_session',
        sessionId: '00000000-0000-4000-8000-000000000001'
      }
    )
    listeners.get(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL)?.({}, { type: 'request_state' })
    expect(replies).toContainEqual({
      type: 'state_changed',
      sessionId: expect.any(String),
      enabled: false,
      count: 0
    })
  } finally {
    dom.window.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
