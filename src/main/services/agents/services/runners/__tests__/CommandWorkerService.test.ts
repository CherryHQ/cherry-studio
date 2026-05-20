import type { GetAgentSessionResponse } from '@types'
import { afterEach, describe, expect, it } from 'vitest'

import { CommandWorkerService, injectModelArgs, resolveDesiredModel } from '../CommandWorkerService'

function buildSession(overrides: Partial<GetAgentSessionResponse> = {}): GetAgentSessionResponse {
  return {
    id: 'session_test',
    agent_id: 'agent_test',
    agent_type: 'shell-script',
    name: 'Worker Test',
    accessible_paths: ['/tmp'],
    model: 'ollama:test',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  } as GetAgentSessionResponse
}

describe('CommandWorkerService', () => {
  const abortControllers: AbortController[] = []

  afterEach(() => {
    for (const controller of abortControllers) {
      controller.abort('test cleanup')
    }
    abortControllers.length = 0
  })

  it('emits an error when accessible paths are missing', async () => {
    const service = new CommandWorkerService()
    const abortController = new AbortController()
    abortControllers.push(abortController)

    const stream = await service.invoke('hello', buildSession({ accessible_paths: [] }), abortController)

    const event = await new Promise<any>((resolve) => {
      stream.once('data', resolve)
    })

    expect(event.type).toBe('error')
    expect(event.error).toBeInstanceOf(Error)
    expect(event.error.message).toContain('No accessible paths')
  })

  it('streams stdout and completes for command-backed workers', async () => {
    const service = new CommandWorkerService()
    const abortController = new AbortController()
    abortControllers.push(abortController)

    const stream = await service.invoke(
      'hello-worker',
      buildSession({
        configuration: {
          permission_mode: 'default',
          max_turns: 100,
          env_vars: {},
          worker_instance_role: 'member',
          worker_model_source: 'worker',
          style_mode: 'normal',
          worker_command: process.execPath,
          worker_args: ['-e', 'process.stdout.write(process.argv[1])', '{{prompt}}']
        }
      }),
      abortController
    )

    const chunks: Array<{ type: string; text?: string }> = []

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (event) => {
        if (event.type === 'chunk' && event.chunk) {
          chunks.push({
            type: event.chunk.type,
            text: (event.chunk as { text?: string }).text
          })
        }

        if (event.type === 'complete') {
          resolve()
        }

        if (event.type === 'error') {
          reject(event.error)
        }
      })
    })

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'start-step',
      'text-start',
      'text-delta',
      'text-end',
      'finish-step'
    ])
    expect(chunks.find((chunk) => chunk.type === 'text-delta')?.text).toContain('hello-worker')
  })

  it('marks stderr output and emits error on non-zero exit', async () => {
    const service = new CommandWorkerService()
    const abortController = new AbortController()
    abortControllers.push(abortController)

    const stream = await service.invoke(
      'stderr-test',
      buildSession({
        configuration: {
          permission_mode: 'default',
          max_turns: 100,
          env_vars: {},
          worker_instance_role: 'member',
          worker_model_source: 'worker',
          style_mode: 'normal',
          worker_command: process.execPath,
          worker_args: ['-e', "process.stderr.write('boom\\n'); process.exit(2)"]
        }
      }),
      abortController
    )

    let sawStderrMetadata = false
    let finalError: Error | undefined

    await new Promise<void>((resolve) => {
      stream.on('data', (event) => {
        if (event.type === 'chunk' && event.chunk?.type === 'text-end') {
          const providerMetadata = (event.chunk as { providerMetadata?: Record<string, unknown> }).providerMetadata
          const commandWorker = providerMetadata?.command_worker as Record<string, unknown> | undefined
          if (commandWorker?.hasStderr === true) {
            sawStderrMetadata = true
          }
        }

        if (event.type === 'error') {
          finalError = event.error
          resolve()
        }
      })
    })

    expect(sawStderrMetadata).toBe(true)
    expect(finalError).toBeInstanceOf(Error)
    expect(finalError && finalError.message).toContain('boom')
  })

  it('injects the cherry-selected model into worker CLI args before the prompt', () => {
    const desiredModel = resolveDesiredModel(
      buildSession({
        agent_type: 'codex',
        model: 'openai:gpt-5.5',
        configuration: {
          permission_mode: 'default',
          max_turns: 100,
          env_vars: {},
          worker_instance_role: 'member',
          worker_model_source: 'cherry',
          style_mode: 'normal',
          worker_command: 'codex',
          worker_args: ['exec', '{{prompt}}']
        }
      }),
      {
        permission_mode: 'default',
        max_turns: 100,
        env_vars: {},
        worker_instance_role: 'member',
        worker_model_source: 'cherry',
        style_mode: 'normal',
        worker_command: 'codex',
        worker_args: ['exec', '{{prompt}}']
      }
    )

    const args = injectModelArgs(['exec', '{{prompt}}'], desiredModel)

    expect(args).toEqual(['exec', '--model', 'gpt-5.5', '{{prompt}}'])
  })

  it('emits cancelled when aborted', async () => {
    const service = new CommandWorkerService()
    const abortController = new AbortController()
    abortControllers.push(abortController)

    const stream = await service.invoke(
      'cancel-test',
      buildSession({
        configuration: {
          permission_mode: 'default',
          max_turns: 100,
          env_vars: {},
          worker_instance_role: 'member',
          worker_model_source: 'worker',
          style_mode: 'normal',
          worker_command: process.execPath,
          worker_args: ['-e', "setInterval(() => process.stdout.write('tick\\n'), 100)"]
        }
      }),
      abortController
    )

    const finalType = await new Promise<string>((resolve) => {
      stream.on('data', (event) => {
        if (event.type === 'chunk' && event.chunk?.type === 'text-delta') {
          abortController.abort('stop now')
        }
        if (event.type === 'cancelled' || event.type === 'complete' || event.type === 'error') {
          resolve(event.type)
        }
      })
    })

    expect(finalType).toBe('cancelled')
  })
})
