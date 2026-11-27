import { Readable, Writable } from 'node:stream'

import { ndJsonStream, RequestError } from '@agentclientprotocol/sdk'

import type { BackendId } from '@cherrystudio/agent-runtime'

import { acpAuthMethods, acpEffortOption, acpModelCatalog, connectAcpClient, type AcpClientOptions } from './client'
import type { AcpModelCatalogReader } from './harness'
import { buildAcpRuntime, type DesktopOptions } from './runtime'
import type { AcpSessionConfiguration } from './types'

function stdioStream(stdin: Writable, stdout: Readable) {
  return ndJsonStream(Writable.toWeb(stdin), Readable.toWeb(stdout) as ReadableStream<Uint8Array>)
}

export function connectAcpStdio(
  stdin: Writable,
  stdout: Readable,
  options: DesktopOptions & {
    backendId: BackendId
    closeAndJoin(): Promise<void>
    report(error: unknown): void
  }
) {
  const runtime = buildAcpRuntime(
    {
      backendId: options.backendId,
      connect: async () => ({ stream: stdioStream(stdin, stdout), closeAndJoin: options.closeAndJoin }),
      report: options.report
    },
    options
  )
  return {
    signal: runtime.signal,
    close: runtime.disconnect,
    initialize: runtime.initializeDesktop,
    async shutdown() {
      const result = await runtime.replay.shutdown()
      if (result.status !== 'confirmed') throw new Error(result.error.message)
    }
  }
}

/** Management connections expose account reads, sign-in and model discovery. */
export function connectAcpManagementStdio(
  stdin: Writable,
  stdout: Readable,
  clientInfo: AcpClientOptions['clientInfo'],
  confirmLoginInBrowser?: AcpClientOptions['confirmLoginInBrowser']
) {
  let optionsBySession: Map<string, AcpSessionConfiguration['configOptions']> | undefined
  const client = connectAcpClient(stdioStream(stdin, stdout), {
    clientInfo,
    callbacks: {},
    confirmLoginInBrowser,
    sessionCapabilities: { configOptions: { boolean: {} } },
    update({ sessionId, update }) {
      if (update.sessionUpdate === 'config_option_update') optionsBySession?.set(sessionId, update.configOptions)
    }
  })
  return {
    signal: client.signal,
    close: client.close,
    async initialize() {
      const agent = await client.initialize()
      return {
        response: agent.response,
        readAccount: agent.readAccount,
        readSubscriptionUsage: agent.readSubscriptionUsage,
        async authenticate(methodId: string) {
          const method = acpAuthMethods(agent.response).find((item) => item.id === methodId)
          if (!method) throw new Error('Unsupported authentication method')
          if (method.type === 'terminal') throw new Error('This authentication method requires external setup')
          await agent.authenticate(method.id)
        },
        async readModels(cwd: string, discovery?: { read?: AcpModelCatalogReader; legacyModes?: 'effort' }) {
          const advertised = discovery?.read && (await agent.readModelCatalog(discovery.read))
          if (advertised) return { ...advertised, closeSession: undefined }
          if (optionsBySession) throw new Error('ACP model discovery is already running')
          optionsBySession = new Map()
          try {
            const { session, configuration } = await agent.create({ cwd, mcpServers: [] })
            const configOptions = optionsBySession.get(session.id) ?? configuration.configOptions
            const { activeModel, models } = acpModelCatalog(configOptions, session.legacyModels)
            const thought = acpEffortOption(configOptions)
            const effortOptions =
              thought?.type === 'select'
                ? thought.options
                    .flatMap((option) => ('group' in option ? option.options : [option]))
                    .map(({ value, name, description }) => ({ value, name, description: description ?? undefined }))
                : configOptions == null && discovery?.legacyModes === 'effort'
                  ? configuration.modes?.availableModes.map(({ id, name, description }) => ({
                      value: id,
                      name,
                      description: description ?? undefined
                    }))
                  : undefined
            return {
              activeModel,
              models: effortOptions?.length
                ? models.map((model) =>
                    model.id === activeModel?.id ? { ...model, effort: { options: effortOptions } } : model
                  )
                : models,
              closeSession: session.close
            }
          } finally {
            optionsBySession = undefined
          }
        }
      }
    }
  }
}

export type AcpManagementAgent = Awaited<ReturnType<ReturnType<typeof connectAcpManagementStdio>['initialize']>>

export const acpHostError = {
  invalidRequest: (reason: string): Error => RequestError.invalidParams(reason),
  cancelled: (): Error => RequestError.requestCancelled()
}

export function formatAcpError(
  error: unknown,
  stderr: string | undefined,
  format: (message: string, detail: string) => string
): unknown {
  if (!(error instanceof Error)) return error
  const data: unknown = error instanceof RequestError ? error.data : undefined
  let detail =
    typeof data === 'string'
      ? data
      : data && typeof data === 'object'
        ? 'details' in data
          ? data.details
          : 'message' in data
            ? data.message
            : undefined
        : undefined
  if (typeof detail !== 'string' && /^(?:ACP connection closed|Local agent process exited)$/.test(error.message))
    detail = stderr
  if (typeof detail !== 'string' || !detail.trim()) return error
  const message = format(error.message, detail)
  return error instanceof RequestError ? new RequestError(error.code, message) : new Error(message)
}
