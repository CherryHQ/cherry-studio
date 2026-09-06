import { application } from '@application'
import type { LoggerService } from '@logger'
import { getShellEnv } from '@main/utils/shellEnv'
import type { McpServer } from '@shared/data/types/mcpServer'

import {
  buildStdioEnvironment,
  type LaunchCommand,
  type LaunchResolutionCache,
  resolveLaunchCommand
} from './mcpLaunch'

export interface ResolvedStdioLaunch {
  readonly launch: LaunchCommand
  readonly loginShellEnv: Record<string, string>
  readonly serverEnv: Record<string, string>
}

/** Resolves the exact command inputs shared by dry-runs and real stdio transports. */
export async function resolveStdioLaunch({
  server,
  args,
  logger,
  signal,
  resolutionCache
}: {
  server: McpServer
  args: string[]
  logger: LoggerService
  signal?: AbortSignal
  resolutionCache?: LaunchResolutionCache
}): Promise<ResolvedStdioLaunch> {
  let command = server.command ?? ''
  signal?.throwIfAborted()
  let launchArgs = args
  const serverEnv: Record<string, string> = { ...server.env }

  if (server.dxtPath) {
    const packages = application.get('McpPackageService')
    if (!packages.isReady) throw new Error('MCP package service is not ready')
    const resolvedConfig = packages.getResolvedMcpConfig(server.dxtPath)
    if (resolvedConfig) {
      command = resolvedConfig.command
      launchArgs = resolvedConfig.args
      Object.assign(serverEnv, resolvedConfig.env)
      logger.debug('Using resolved package config', { command, args: launchArgs })
    } else {
      logger.warn('Failed to resolve package config, falling back to manifest values')
    }
  }

  const loginShellEnv = await getShellEnv(signal)
  const launch = await resolveLaunchCommand({
    command,
    args: launchArgs,
    registryUrl: server.registryUrl,
    loginShellEnv: buildStdioEnvironment(loginShellEnv, serverEnv),
    logger,
    signal,
    resolutionCache
  })
  return { launch, loginShellEnv, serverEnv }
}
