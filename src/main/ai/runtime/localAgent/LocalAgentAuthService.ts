import { stripVTControlCharacters } from 'node:util'

import { shell } from 'electron'

import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { localAgentChatProtocol, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import { isSensitiveKey, redactLiteral } from '@shared/utils/redaction'

import { AcpConnection } from './AcpConnection'
import { type CliAuthCommandSpec, type CliAuthOptions, extractAuthPrompt, resolveCliAuthCommand } from './cliAuth'
import { resolveLocalAgentLaunch } from './launch'

const AUTH_TIMEOUT_MS = 300_000
const MAX_OUTPUT_CHARS = 4000

function redactAuthMessage(message: string, config: LocalAgentConfiguration, secret?: string): string {
  let sanitized = message
  if (secret) sanitized = redactLiteral(sanitized, secret)
  for (const [key, value] of Object.entries(config.env)) {
    if (isSensitiveKey(key)) sanitized = redactLiteral(sanitized, value)
  }
  return sanitized
}

@Injectable('LocalAgentAuthService')
@ServicePhase(Phase.Background)
@DependsOn(['BinaryManager'])
export class LocalAgentAuthService extends BaseService {
  private readonly pending = new Map<string, () => Promise<void>>()

  async authenticate(
    requestId: string,
    config: LocalAgentConfiguration,
    methodId: string,
    options?: CliAuthOptions
  ): Promise<void> {
    if (this.pending.has(requestId)) throw new Error('Authentication is already in progress')
    if (localAgentChatProtocol(config) === 'cursor') {
      if (methodId !== 'cursor_login') throw new Error('Unknown Cursor authentication method')
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)])
      this.pending.set(requestId, async () => controller.abort())
      try {
        const { cursorLogin } = await import('@cherrystudio/agent-runtime-cursor')
        await cursorLogin(signal, async (url) => {
          signal.throwIfAborted()
          if (new URL(url).protocol !== 'https:') throw new Error('Invalid Cursor login URL')
          await shell.openExternal(url)
        })
      } finally {
        this.pending.delete(requestId)
      }
      return
    }
    const cliSpec = resolveCliAuthCommand(config.presetId, methodId, options)
    if (cliSpec) {
      await this.authenticateViaCli(requestId, config, cliSpec, options?.secret)
      return
    }
    if (localAgentChatProtocol(config) !== 'acp') throw new Error('ACP authentication is unavailable')

    const live = new AcpConnection(`local-agent-auth:${requestId}`, '', config)
    this.pending.set(requestId, () => live.close())
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        (async () => {
          await live.start(application.getPath('cherry.bin'), undefined, true)
          await live.authenticate(methodId)
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Authentication timed out')), AUTH_TIMEOUT_MS)
        })
      ])
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      throw new Error(redactAuthMessage(rawMessage, config, options?.secret))
    } finally {
      clearTimeout(timer)
      try {
        await live.close()
      } finally {
        this.pending.delete(requestId)
      }
    }
  }

  private async authenticateViaCli(
    requestId: string,
    config: LocalAgentConfiguration,
    spec: CliAuthCommandSpec,
    secret?: string
  ): Promise<void> {
    let aborted = false
    let killChild: () => Promise<void> = async () => {
      aborted = true
    }
    this.pending.set(requestId, () => killChild())

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const launch = await resolveLocalAgentLaunch(config, undefined, true)
      if (aborted) throw new Error('Authentication cancelled')

      await new Promise<void>((resolve, reject) => {
        let settled = false
        let recentOutput = ''
        let lastUrl: string | undefined
        let lastCode: string | undefined
        let openedUrl: string | undefined

        const child = crossPlatformSpawn(launch.executable, spec.args, {
          env: launch.env,
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe']
        })

        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (error) reject(error)
          else resolve()
        }

        const stopChild = async () => {
          if (child.exitCode !== null || child.signalCode !== null) return
          if (process.platform === 'win32') {
            await terminateProcessTree(child, true, 'local agent authentication').catch(() => undefined)
            return
          }
          await terminateProcessTree(child, false, 'local agent authentication').catch(() => undefined)
          if (!(await waitForProcessExit(child, 1000))) {
            await terminateProcessTree(child, true, 'local agent authentication').catch(() => undefined)
          }
        }

        const terminateChild = async () => {
          aborted = true
          await stopChild()
          finish(new Error('Authentication cancelled'))
        }
        killChild = terminateChild

        timer = setTimeout(() => {
          void stopChild()
          finish(new Error('Authentication timed out'))
        }, AUTH_TIMEOUT_MS)

        const handleChunk = (chunk: Buffer | string) => {
          recentOutput = (recentOutput + chunk.toString()).slice(-MAX_OUTPUT_CHARS)
          const prompt = extractAuthPrompt(recentOutput)
          const nextUrl = prompt.url ?? lastUrl
          const nextCode = prompt.code ?? lastCode
          if ((nextUrl && nextUrl !== lastUrl) || (nextCode && nextCode !== lastCode)) {
            lastUrl = nextUrl
            lastCode = nextCode
            application.get('IpcApiService').broadcast('ai.local_agents.auth_prompt', {
              requestId,
              ...(nextUrl ? { url: nextUrl } : {}),
              ...(nextCode ? { code: nextCode } : {})
            })
          }
          if (
            spec.autoOpenUrl &&
            nextUrl &&
            nextUrl !== openedUrl &&
            (nextUrl.startsWith('https://') || nextUrl.startsWith('http://'))
          ) {
            openedUrl = nextUrl
            void shell.openExternal(nextUrl).catch(() => undefined)
          }
        }

        child.stdout?.on('data', handleChunk)
        child.stderr?.on('data', handleChunk)
        child.on('error', (error) => finish(error))
        child.on('close', (code, signal) => {
          if (aborted) {
            finish(new Error('Authentication cancelled'))
            return
          }
          if (code === 0) {
            finish()
            return
          }
          const cleaned = stripVTControlCharacters(recentOutput).trim()
          const tail = cleaned.split(/\r?\n/).filter(Boolean).slice(-4).join(' ')
          finish(new Error(tail || `Authentication failed with exit code ${code ?? signal ?? 'unknown'}`))
        })

        if (spec.stdin !== undefined) {
          child.stdin?.write(spec.stdin)
        }
        child.stdin?.end()
      })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      throw new Error(redactAuthMessage(rawMessage, config, secret))
    } finally {
      clearTimeout(timer)
      this.pending.delete(requestId)
    }
  }

  async cancel(requestId: string): Promise<void> {
    await this.pending.get(requestId)?.()
  }

  protected async onStop() {
    try {
      await Promise.all([...this.pending.values()].map((stop) => stop()))
    } finally {
      this.pending.clear()
    }
  }
}
