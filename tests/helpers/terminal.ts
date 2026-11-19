import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type {
  UtilityProcessInstanceOptions,
  UtilityProcessStreamFrame,
  UtilityProcessStreamOptions
} from '@main/core/utilityProcess/types'
import type { TerminalHostContract, TerminalHostInit } from '@main/services/terminal/contracts'
import { TerminalService } from '@main/services/terminal/TerminalService'
import { TerminalHost } from '@main/services/terminal/utilityEntries/TerminalHost'
import { AsyncEventQueue } from '@shared/utils/async'

/** Exercises native runtime tools against real scopes and VT, substituting only Electron's utility transport. */
export async function createTestTerminalService() {
  const root = process.cwd()
  execFileSync('node', ['native/terminal-scope/build.cjs'], { cwd: root })
  const original = vi.mocked(application.getPath).getMockImplementation()!
  vi.mocked(application.getPath).mockImplementation((key, file) => {
    if (key === 'feature.terminal.scope_helper_file')
      return path.join(
        root,
        'resources/binaries',
        `${process.platform}-${process.arch}`,
        process.platform === 'win32' ? 'terminal-scope.exe' : 'terminal-scope'
      )
    if (key === 'feature.terminal.ghostty') return path.join(root, 'resources/terminal/ghostty')
    if (key === 'feature.terminal.integration') return path.join(root, 'resources/terminal/shellIntegration')
    return original(key, file)
  })
  const logger = { debug() {}, info() {}, warn() {}, error() {} }
  MockApplicationUtils.setService('UtilityProcessManager', {
    register() {},
    createInstance(_definition: unknown, options: UtilityProcessInstanceOptions<TerminalHostInit>) {
      const ready = Promise.resolve(options.createInitData!()).then((init) => new TerminalHost(init, logger))
      return {
        async request(method: keyof TerminalHostContract['methods'], input: never) {
          const host = await ready
          if (method === 'identity') return host.init.host
          if (method === 'mutate') return host.mutate(input)
          if (method === 'view') return host.view(input)
          if (method === 'link') return host.link(input)
          if (method === 'operation') {
            const v = input as TerminalHostContract['methods']['operation']['input']
            return host.operation(v.host, v.id)
          }
          if (method === 'release') {
            const v = input as TerminalHostContract['methods']['release']['input']
            return host.release(v.host, v.id)
          }
          if (method === 'seal') {
            const v = input as TerminalHostContract['methods']['seal']['input']
            return host.seal(v.host, v.admissionRevision)
          }
          if (method === 'detachView') {
            const v = input as TerminalHostContract['methods']['detachView']['input']
            return host.detachView(v.host, v.id, v.viewId)
          }
          throw new Error(`Unexpected terminal method: ${method}`)
        },
        async openStream(_method: unknown, _input: unknown, stream: UtilityProcessStreamOptions) {
          const host = await ready
          const output = new AsyncEventQueue<UtilityProcessStreamFrame>()
          const completed = host
            .observe(host.init.host, {
              signal: stream.signal!,
              input: (async function* () {})(),
              logger,
              write: async (frame) => {
                output.push(frame)
              }
            })
            .finally(() => output.close())
          return { output, completed, closed: completed }
        },
        async stop() {
          const host = await ready
          await host.seal(host.init.host, Number.MAX_SAFE_INTEGER)
        },
        async dispose() {}
      }
    }
  })
  BaseService.resetInstances()
  const service = new TerminalService()
  MockApplicationUtils.setService('TerminalService', service)
  await service._doInit()
  return service
}
