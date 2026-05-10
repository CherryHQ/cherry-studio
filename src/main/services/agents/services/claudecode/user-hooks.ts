// src/main/services/agents/services/claudecode/user-hooks.ts
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { HookCallback, HookCallbackMatcher, HookEvent, HookInput } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { app } from 'electron'

const logger = loggerService.withContext('UserHooks')

// ─── Types for user-defined hooks in settings.json ───

/** Command-based hook (PR custom format). */
type UserHookCommandConfig = {
  type: 'command'
  command: string
  timeout?: number
}

/** Prompt-based hook (native Claude Code settings.json format). */
type UserHookPromptConfig = {
  type?: string
  tool?: string
  matcher?: string
  description?: string
  prompt: string
}

type UserHookConfig = UserHookCommandConfig | UserHookPromptConfig

/** Matcher wrapper (PR custom format). */
type UserHookMatcherConfig = {
  matcher?: string
  hooks: UserHookConfig[]
}

type UserHooksJson = {
  hooks?: Partial<Record<HookEvent, (UserHookMatcherConfig | UserHookPromptConfig)[]>>
}

// ─── Load hooks from a single settings.json ───

async function loadHooksFromSettings(settingsPath: string): Promise<UserHooksJson['hooks'] | undefined> {
  try {
    const content = await fs.readFile(settingsPath, 'utf-8')
    const config = JSON.parse(content) as UserHooksJson
    return config.hooks
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    logger.warn('Failed to load hooks from settings', { path: settingsPath, error: (error as Error).message })
    return undefined
  }
}

// ─── Convert a prompt-based user hook to a HookCallback ───

function createPromptHookCallback(config: UserHookPromptConfig): HookCallback {
  return async (input: HookInput) => {
    const hookSpecificOutput: any = {
      hookEventName: input.hook_event_name,
      additionalContext: config.prompt
    }
    return { hookSpecificOutput }
  }
}

// ─── Convert a command-based user hook to a HookCallback ───

function createCommandHookCallback(config: UserHookCommandConfig): HookCallback {
  return async (input: HookInput, _toolUseID: string | undefined, options) => {
    return new Promise((resolve) => {
      // On Windows, user hooks often contain bash syntax (e.g. `if [ -f ... ]`).
      // Prefer Git Bash (detected by Claude Code) over cmd.exe for compatibility.
      const shell = process.env.CLAUDE_CODE_GIT_BASH_PATH || true
      const child = spawn(config.command, {
        shell,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: input.cwd,
        env: process.env
      })

      let stdout = ''
      let stderr = ''

      const timeoutMs = config.timeout ? config.timeout * 1000 : 30000 // default 30s
      const timeout = setTimeout(() => {
        logger.warn('Hook command timed out', { command: config.command, timeout: timeoutMs })
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 5000).unref?.()
      }, timeoutMs)

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('error', (error) => {
        clearTimeout(timeout)
        logger.error('Hook command failed to spawn', { command: config.command, error: error.message })
        resolve({})
      })

      child.on('close', (code) => {
        clearTimeout(timeout)

        if (code !== 0 && code !== null) {
          logger.warn('Hook command exited with non-zero code', {
            command: config.command,
            code,
            stderr: stderr.slice(0, 500)
          })
        }

        const trimmed = stdout.trim()
        if (!trimmed) {
          resolve({})
          return
        }

        // Command hook stdout is treated as additional context for the AI.
        // Map it to hookSpecificOutput.additionalContext so the SDK appends it.

        const hookSpecificOutput: any = {
          hookEventName: input.hook_event_name,
          additionalContext: trimmed
        }
        resolve({ hookSpecificOutput })
      })

      const signal = options?.signal
      if (signal) {
        const abortHandler = () => {
          clearTimeout(timeout)
          child.kill('SIGTERM')
          resolve({})
        }
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      // Send hook input as JSON to stdin
      child.stdin.write(JSON.stringify(input), 'utf-8', (err) => {
        if (err) {
          logger.warn('Failed to write hook input to stdin', { command: config.command, error: err.message })
        }
        child.stdin.end()
      })
    })
  }
}

// ─── Convert user matchers to SDK HookCallbackMatcher array ───

function isCommandHook(h: UserHookConfig): h is UserHookCommandConfig {
  return h.type === 'command'
}

function convertUserMatchers(matchers: UserHookMatcherConfig[]): HookCallbackMatcher[] {
  return matchers.map((m) => ({
    matcher: m.matcher,
    hooks: m.hooks.map((h) => {
      if (isCommandHook(h)) {
        return createCommandHookCallback(h)
      }
      // Native Claude Code prompt-based hook
      return createPromptHookCallback(h)
    })
  }))
}

// ─── Load user hooks from all relevant settings files ───

export async function loadUserHooks(
  cwd: string
): Promise<Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined> {
  const settingsPaths = [
    path.join(cwd, '.claude', 'settings.json'), // project-level
    path.join(os.homedir(), '.claude', 'settings.json'), // standard user-level
    path.join(app.getPath('userData'), '.claude', 'settings.json') // Cherry Studio isolated
  ]

  const configs = await Promise.all(settingsPaths.map(loadHooksFromSettings))

  // Merge configs: later paths override earlier ones for the same event.
  // Normalise raw entries into UserHookMatcherConfig so both native prompt-based
  // objects and PR-style matcher wrappers are handled uniformly.
  const mergedMatchers: Partial<Record<HookEvent, UserHookMatcherConfig[]>> = {}
  for (const config of configs) {
    if (!config) continue
    for (const [event, entries] of Object.entries(config)) {
      const eventKey = event as HookEvent
      for (const entry of entries) {
        // PR-style matcher wrapper: { matcher?: string, hooks: [...] }
        if ('hooks' in entry && Array.isArray((entry as UserHookMatcherConfig).hooks)) {
          mergedMatchers[eventKey] = [...(mergedMatchers[eventKey] ?? []), entry as UserHookMatcherConfig]
        } else {
          // Native Claude Code prompt-based hook: { type, tool, prompt, ... }
          const promptEntry = entry as UserHookPromptConfig
          mergedMatchers[eventKey] = [
            ...(mergedMatchers[eventKey] ?? []),
            {
              matcher: promptEntry.tool ?? promptEntry.matcher,
              hooks: [promptEntry]
            }
          ]
        }
      }
    }
  }

  if (Object.keys(mergedMatchers).length === 0) {
    return undefined
  }

  const result: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {}
  for (const [event, matchers] of Object.entries(mergedMatchers)) {
    result[event as HookEvent] = convertUserMatchers(matchers)
  }

  logger.info('Loaded user hooks', {
    events: Object.keys(result),
    totalMatchers: Object.values(result).reduce((sum, m) => sum + (m?.length ?? 0), 0)
  })

  return result
}

// ─── Merge system hooks with user hooks ───

/**
 * Merge system hooks with user hooks.
 * System hooks run first, then user hooks.
 * This ensures Cherry Studio's permission gate and RTK rewrite happen before
 * user-defined hooks.
 */
export function mergeHooks(
  systemHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>,
  userHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  if (!userHooks || Object.keys(userHooks).length === 0) {
    return systemHooks
  }

  const merged: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {}
  const allEvents = new Set<HookEvent>([
    ...(Object.keys(systemHooks) as HookEvent[]),
    ...(Object.keys(userHooks) as HookEvent[])
  ])

  for (const event of allEvents) {
    merged[event] = [...(systemHooks[event] ?? []), ...(userHooks[event] ?? [])]
  }

  return merged
}
