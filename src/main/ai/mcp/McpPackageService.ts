import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { fileStorage } from '@main/services/FileStorage'
import { IpcChannel } from '@shared/IpcChannel'
import * as fs from 'fs'
import StreamZip from 'node-stream-zip'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('McpPackageService')

/**
 * Ensure a target path is within the base directory to prevent path traversal attacks.
 * This is the correct approach: validate the final resolved path rather than sanitizing input.
 *
 * @param basePath - The base directory that the target must be within
 * @param targetPath - The target path to validate
 * @returns The resolved target path if valid
 * @throws Error if the target path escapes the base directory
 */
export function ensurePathWithin(basePath: string, targetPath: string): string {
  const resolvedBase = path.resolve(basePath)
  const resolvedTarget = path.resolve(path.normalize(targetPath))

  // Must be direct child of base directory, no subdirectories allowed
  if (path.dirname(resolvedTarget) !== resolvedBase) {
    throw new Error('Path traversal detected: target path must be direct child of base directory')
  }

  return resolvedTarget
}

/**
 * Guard against zip-slip: `node-stream-zip` writes each entry at `path.join(baseDir, entry.name)`
 * with no containment check, so a name like `../../../foo` would escape `baseDir`. Reject any entry
 * whose resolved destination is outside `baseDir` before extraction. Unlike {@link ensurePathWithin},
 * nested subdirectories are allowed (a DXT archive legitimately contains them).
 *
 * @throws Error if any entry name escapes `baseDir`
 */
export function assertZipEntriesWithin(entryNames: string[], baseDir: string): void {
  const root = path.resolve(baseDir)
  for (const name of entryNames) {
    const dest = path.resolve(baseDir, name)
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(`Unsafe DXT entry path (zip-slip): ${name}`)
    }
  }
}

interface BaseMcpPackageManifest {
  name: string
  display_name?: string
  version: string
  description?: string
  long_description?: string
  author?: {
    name?: string
    email?: string
    url?: string
  }
  repository?: {
    type?: string
    url?: string
  }
  homepage?: string
  documentation?: string
  support?: string
  icon?: string
  server: {
    type: string
    entry_point: string
    mcp_config: {
      command: string
      args: string[]
      env?: Record<string, string>
      platform_overrides?: {
        [platform: string]: {
          command?: string
          args?: string[]
          env?: Record<string, string>
        }
      }
    }
  }
  tools?: Array<{
    name: string
    description: string
  }>
  keywords?: string[]
  license?: string
  user_config?: Record<string, any>
  compatibility?: {
    claude_desktop?: string
    platforms?: string[]
    runtimes?: Record<string, string>
  }
}

export interface DxtManifest extends BaseMcpPackageManifest {
  dxt_version: string
}

export interface McpbManifest extends BaseMcpPackageManifest {
  manifest_version: string
}

export type McpPackageManifest = DxtManifest | McpbManifest

type ParsedMcpPackageManifest = BaseMcpPackageManifest & {
  dxt_version?: string
  manifest_version?: string
}

export interface McpPackageUploadResult {
  success: boolean
  data?: {
    manifest: McpPackageManifest
    extractDir: string
  }
  error?: string
}

export type McpPackageFormat = 'dxt' | 'mcpb'

const MCP_PACKAGE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024

/**
 * Validate and sanitize a command to prevent path traversal attacks.
 * Commands should be either:
 * 1. Simple command names (e.g., "node", "python", "npx") - looked up in PATH
 * 2. Absolute paths (e.g., "/usr/bin/node", "C:\\Program Files\\node\\node.exe")
 * 3. Relative paths starting with ./ or .\ (relative to extractDir)
 *
 * Rejects commands containing path traversal sequences (..)
 *
 * @param command - The command to validate
 * @returns The validated command
 * @throws Error if command contains path traversal or is invalid
 */
export function validateCommand(command: string): string {
  if (!command || typeof command !== 'string') {
    throw new Error('Invalid command: command must be a non-empty string')
  }

  const trimmed = command.trim()
  if (!trimmed) {
    throw new Error('Invalid command: command cannot be empty')
  }

  // Check for path traversal sequences
  // This catches: .., ../, ..\, /../, \..\, etc.
  if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(trimmed) || trimmed === '..') {
    throw new Error(`Invalid command: path traversal detected in "${command}"`)
  }

  // Check for null bytes
  if (trimmed.includes('\0')) {
    throw new Error('Invalid command: null byte detected')
  }

  return trimmed
}

/**
 * Validate command arguments to prevent injection attacks.
 * Rejects arguments containing path traversal sequences.
 *
 * @param args - The arguments array to validate
 * @returns The validated arguments array
 * @throws Error if any argument contains path traversal
 */
export function validateArgs(args: string[]): string[] {
  if (!Array.isArray(args)) {
    throw new Error('Invalid args: must be an array')
  }

  return args.map((arg, index) => {
    if (typeof arg !== 'string') {
      throw new Error(`Invalid args: argument at index ${index} must be a string`)
    }

    // Check for null bytes
    if (arg.includes('\0')) {
      throw new Error(`Invalid args: null byte detected in argument at index ${index}`)
    }

    // Check for path traversal in arguments that look like paths
    // Only validate if the arg contains path separators (indicating it's meant to be a path)
    if ((arg.includes('/') || arg.includes('\\')) && /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(arg)) {
      throw new Error(`Invalid args: path traversal detected in argument at index ${index}`)
    }

    return arg
  })
}

export function performVariableSubstitution(
  value: string,
  extractDir: string,
  userConfig?: Record<string, any>
): string {
  let result = value

  // Replace ${__dirname} with the extraction directory
  result = result.replace(/\$\{__dirname\}/g, extractDir)

  // Replace ${HOME} with user's home directory
  result = result.replace(/\$\{HOME\}/g, application.getPath('sys.home'))

  // Replace ${DESKTOP} with user's desktop directory
  result = result.replace(/\$\{DESKTOP\}/g, application.getPath('sys.desktop'))

  // Replace ${DOCUMENTS} with user's documents directory
  result = result.replace(/\$\{DOCUMENTS\}/g, application.getPath('sys.documents'))

  // Replace ${DOWNLOADS} with user's downloads directory
  result = result.replace(/\$\{DOWNLOADS\}/g, application.getPath('sys.downloads'))

  // Replace ${pathSeparator} or ${/} with the platform-specific path separator
  result = result.replace(/\$\{pathSeparator\}/g, path.sep)
  result = result.replace(/\$\{\/\}/g, path.sep)

  // Replace ${user_config.KEY} with user-configured values
  if (userConfig) {
    result = result.replace(/\$\{user_config\.([^}]+)\}/g, (match, key) => {
      return userConfig[key] || match // Keep original if not found
    })
  }

  return result
}

/**
 * Process-affecting environment variables that must never be set from MCP package config.
 * These can alter how the spawned process loads code (preloading shared libraries, injecting
 * Node flags), so a malicious manifest could use them to execute arbitrary code despite the
 * command/arg validation above.
 */
const DXT_ENV_DENYLIST = ['NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH']

/**
 * Validate an MCP package environment map and build a new sanitized object.
 * Package env values bypass the command/arg validation, so apply equivalent hardening here:
 * reject null bytes in keys/values and denylist process-affecting variables.
 *
 * @throws Error if a key/value contains a null byte or a key is denylisted
 */
export function buildResolvedEnv(
  env: Record<string, string>,
  extractDir: string,
  userConfig?: Record<string, any>
): Record<string, string> {
  const resolvedEnv: Record<string, string> = {}

  for (const [key, value] of Object.entries(env)) {
    if (key.includes('\0')) {
      throw new Error('Invalid MCP package env: null byte detected in environment variable name')
    }

    // Denylist process-affecting variables (DYLD_* on macOS, plus exact matches above).
    const canonicalKey = key.toUpperCase()
    if (DXT_ENV_DENYLIST.includes(canonicalKey) || canonicalKey.startsWith('DYLD_')) {
      throw new Error(`Invalid MCP package env: environment variable "${key}" is not allowed`)
    }

    const substituted = performVariableSubstitution(value, extractDir, userConfig)
    if (substituted.includes('\0')) {
      throw new Error(`Invalid MCP package env: null byte detected in value of environment variable "${key}"`)
    }

    resolvedEnv[key] = substituted
  }

  return resolvedEnv
}

export function validatePackageUploadPayload(
  fileBuffer: ArrayBuffer | NodeJS.ArrayBufferView,
  fileName: string,
  packageFormat: McpPackageFormat
): Buffer {
  if (typeof fileName !== 'string') {
    throw new Error('Invalid MCP package upload: file name must be a string')
  }

  const trimmedFileName = fileName.trim()
  if (!trimmedFileName) {
    throw new Error('Invalid MCP package upload: file name cannot be empty')
  }
  if (trimmedFileName !== fileName) {
    throw new Error('Invalid MCP package upload: file name cannot contain leading or trailing whitespace')
  }
  if (trimmedFileName.includes('\0') || /[/\\]/.test(trimmedFileName)) {
    throw new Error('Invalid MCP package upload: file name cannot contain path separators')
  }
  if (!/^[A-Za-z0-9._ ()@+-]+$/.test(trimmedFileName)) {
    throw new Error('Invalid MCP package upload: file name contains unsupported characters')
  }
  if (path.extname(trimmedFileName).toLowerCase() !== `.${packageFormat}`) {
    throw new Error(`Invalid MCP package upload: expected a .${packageFormat} file`)
  }

  let buffer: Buffer
  if (fileBuffer instanceof ArrayBuffer) {
    buffer = Buffer.from(fileBuffer)
  } else if (ArrayBuffer.isView(fileBuffer)) {
    buffer = Buffer.from(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength)
  } else {
    throw new Error('Invalid MCP package upload: file buffer must be an ArrayBuffer')
  }

  if (buffer.byteLength === 0) {
    throw new Error('Invalid MCP package upload: file buffer cannot be empty')
  }
  if (buffer.byteLength > MCP_PACKAGE_UPLOAD_MAX_BYTES) {
    throw new Error('Invalid MCP package upload: file exceeds the 100 MiB size limit')
  }

  return buffer
}

export function applyPlatformOverrides(mcpConfig: any, extractDir: string, userConfig?: Record<string, any>): any {
  const platform = process.platform
  // Deep-copy the nested env so substitution never mutates the caller's manifest object.
  const resolvedConfig = { ...mcpConfig, env: mcpConfig.env ? { ...mcpConfig.env } : mcpConfig.env }

  // Apply platform-specific overrides
  if (mcpConfig.platform_overrides && mcpConfig.platform_overrides[platform]) {
    const override = mcpConfig.platform_overrides[platform]

    // Override command if specified
    if (override.command) {
      resolvedConfig.command = override.command
    }

    // Override args if specified
    if (override.args) {
      resolvedConfig.args = override.args
    }

    // Merge environment variables
    if (override.env) {
      resolvedConfig.env = { ...resolvedConfig.env, ...override.env }
    }
  }

  // Apply variable substitution to all string values
  if (resolvedConfig.command) {
    resolvedConfig.command = performVariableSubstitution(resolvedConfig.command, extractDir, userConfig)
    // Validate command after substitution to prevent path traversal attacks
    resolvedConfig.command = validateCommand(resolvedConfig.command)
  }

  if (resolvedConfig.args) {
    resolvedConfig.args = resolvedConfig.args.map((arg: string) =>
      performVariableSubstitution(arg, extractDir, userConfig)
    )
    // Validate args after substitution to prevent path traversal attacks
    resolvedConfig.args = validateArgs(resolvedConfig.args)
  }

  if (resolvedConfig.env) {
    // Build a new env object rather than mutating; also rejects null bytes and denylisted vars.
    resolvedConfig.env = buildResolvedEnv(resolvedConfig.env, extractDir, userConfig)
  }

  return resolvedConfig
}

export interface ResolvedMcpConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

@Injectable('McpPackageService')
@ServicePhase(Phase.WhenReady)
export class McpPackageService extends BaseService {
  private get tempDir(): string {
    return application.getPath('feature.dxt.uploads.temp')
  }
  private get mcpDir(): string {
    return application.getPath('feature.mcp')
  }

  private async moveDirectory(source: string, destination: string): Promise<void> {
    try {
      // Try rename first (works if on same filesystem)
      fs.renameSync(source, destination)
    } catch (error) {
      // If rename fails (cross-filesystem), use copy + remove
      logger.debug('Cross-filesystem move detected, using copy + remove')

      // Ensure parent directory exists
      const parentDir = path.dirname(destination)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      // Recursively copy directory
      await this.copyDirectory(source, destination)

      // Remove source directory
      fs.rmSync(source, { recursive: true, force: true })
    }
  }

  private async copyDirectory(source: string, destination: string): Promise<void> {
    // Create destination directory
    fs.mkdirSync(destination, { recursive: true })

    // Read source directory
    const entries = fs.readdirSync(source, { withFileTypes: true })

    // Copy each entry
    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name)
      const destPath = path.join(destination, entry.name)

      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, destPath)
      } else {
        fs.copyFileSync(sourcePath, destPath)
      }
    }
  }

  private async replacePackageDirectory(source: string, destination: string, serverDirName: string): Promise<void> {
    const stagedDir = ensurePathWithin(this.mcpDir, path.join(this.mcpDir, `${serverDirName}.staged-${uuidv4()}`))
    const backupDir = ensurePathWithin(this.mcpDir, path.join(this.mcpDir, `${serverDirName}.backup-${uuidv4()}`))
    let hasBackup = false

    try {
      await this.moveDirectory(source, stagedDir)

      if (fs.existsSync(destination)) {
        logger.debug(`Moving existing server directory to backup: ${destination}`)
        fs.renameSync(destination, backupDir)
        hasBackup = true
      }

      fs.renameSync(stagedDir, destination)

      if (hasBackup) {
        try {
          fs.rmSync(backupDir, { recursive: true, force: true })
        } catch (error) {
          logger.warn(`Failed to remove old MCP package backup: ${backupDir}`, error as Error)
        }
      }
    } catch (error) {
      if (hasBackup && !fs.existsSync(destination) && fs.existsSync(backupDir)) {
        fs.renameSync(backupDir, destination)
      }
      if (fs.existsSync(stagedDir)) {
        try {
          fs.rmSync(stagedDir, { recursive: true, force: true })
        } catch (cleanupError) {
          logger.warn(`Failed to remove staged MCP package directory: ${stagedDir}`, cleanupError as Error)
        }
      }
      throw error
    }
  }

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
  }

  protected async onStop(): Promise<void> {
    this.cleanup()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Mcp_UploadDxt, async (event, fileBuffer: ArrayBuffer, fileName: string) => {
      try {
        const fileData = validatePackageUploadPayload(fileBuffer, fileName, 'dxt')
        const tempPath = await fileStorage.createTempFile(event, fileName)
        await fileStorage.writeFile(event, tempPath, fileData)
        return await this.uploadDxt(event, tempPath)
      } catch (error) {
        logger.error('DXT upload error:', error as Error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to upload DXT file'
        }
      }
    })
    this.ipcHandle(IpcChannel.Mcp_UploadMcpb, async (event, fileBuffer: ArrayBuffer, fileName: string) => {
      try {
        const fileData = validatePackageUploadPayload(fileBuffer, fileName, 'mcpb')
        const tempPath = await fileStorage.createTempFile(event, fileName)
        await fileStorage.writeFile(event, tempPath, fileData)
        return await this.uploadMcpb(event, tempPath)
      } catch (error) {
        logger.error('MCPB upload error:', error as Error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to upload MCPB file'
        }
      }
    })
  }

  public async uploadDxt(event: Electron.IpcMainInvokeEvent, filePath: string): Promise<McpPackageUploadResult> {
    return this.uploadPackage(event, filePath, 'dxt')
  }

  public async uploadMcpb(event: Electron.IpcMainInvokeEvent, filePath: string): Promise<McpPackageUploadResult> {
    return this.uploadPackage(event, filePath, 'mcpb')
  }

  private async uploadPackage(
    _: Electron.IpcMainInvokeEvent,
    filePath: string,
    packageFormat: McpPackageFormat
  ): Promise<McpPackageUploadResult> {
    const packageLabel = packageFormat === 'mcpb' ? 'MCPB' : 'DXT'
    const tempExtractDir = path.join(this.tempDir, `${packageFormat}_${uuidv4()}`)

    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`${packageLabel} file not found`)
      }

      // Extract the package file (which is a ZIP archive) to a temporary directory
      logger.debug(`Extracting ${packageLabel} file: ${filePath}`)

      const zip = new StreamZip.async({ file: filePath })
      try {
        // Reject any zip-slip entry before writing anything to disk.
        assertZipEntriesWithin(Object.keys(await zip.entries()), tempExtractDir)
        await zip.extract(null, tempExtractDir)
      } finally {
        await zip.close()
      }

      // Read and validate the manifest.json
      const manifestPath = path.join(tempExtractDir, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`manifest.json not found in ${packageLabel} file`)
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
      const parsedManifest: ParsedMcpPackageManifest = JSON.parse(manifestContent)

      // Validate required fields in manifest
      let manifest: McpPackageManifest
      if (packageFormat === 'mcpb') {
        if (!parsedManifest.manifest_version) {
          throw new Error('Invalid manifest: missing manifest_version')
        }
        manifest = { ...parsedManifest, manifest_version: parsedManifest.manifest_version }
      } else {
        if (!parsedManifest.dxt_version) {
          throw new Error('Invalid manifest: missing dxt_version')
        }
        manifest = { ...parsedManifest, dxt_version: parsedManifest.dxt_version }
      }
      if (!manifest.name) {
        throw new Error('Invalid manifest: missing name')
      }
      if (!manifest.version) {
        throw new Error('Invalid manifest: missing version')
      }
      if (!manifest.server) {
        throw new Error('Invalid manifest: missing server configuration')
      }
      if (!manifest.server.mcp_config) {
        throw new Error('Invalid manifest: missing server.mcp_config')
      }
      if (!manifest.server.mcp_config.command) {
        throw new Error('Invalid manifest: missing server.mcp_config.command')
      }
      if (!Array.isArray(manifest.server.mcp_config.args)) {
        throw new Error('Invalid manifest: server.mcp_config.args must be an array')
      }

      // Use server name as the final extract directory for automatic version management
      const serverDirName = `server-${manifest.name}`
      const finalExtractDir = ensurePathWithin(this.mcpDir, path.join(this.mcpDir, serverDirName))

      // Stage the new package first, then swap directories so a failed install
      // does not destroy the last working version.
      await this.replacePackageDirectory(tempExtractDir, finalExtractDir, serverDirName)
      logger.debug(`${packageLabel} server extracted to: ${finalExtractDir}`)

      // Clean up the uploaded package file if it's in temp directory
      if (filePath.startsWith(this.tempDir)) {
        fs.unlinkSync(filePath)
      }

      // Return success with manifest and extraction path
      return {
        success: true,
        data: {
          manifest,
          extractDir: finalExtractDir
        }
      }
    } catch (error) {
      // Clean up on error
      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true })
      }

      const errorMessage = error instanceof Error ? error.message : `Failed to process ${packageLabel} file`
      logger.error(`${packageLabel} upload error:`, error as Error)

      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * Get resolved MCP configuration for a package server with platform overrides and variable substitution
   */
  public getResolvedMcpConfig(dxtPath: string, userConfig?: Record<string, any>): ResolvedMcpConfig | null {
    try {
      // Read the manifest from the package server directory
      const manifestPath = path.join(dxtPath, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        logger.error(`Manifest not found: ${manifestPath}`)
        return null
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
      const manifest: McpPackageManifest = JSON.parse(manifestContent)

      if (!manifest.server?.mcp_config) {
        logger.error('No mcp_config found in manifest')
        return null
      }

      // Apply platform overrides and variable substitution
      const resolvedConfig = applyPlatformOverrides(manifest.server.mcp_config, dxtPath, userConfig)

      logger.debug('Resolved MCP config:', {
        command: resolvedConfig.command,
        args: resolvedConfig.args,
        env: resolvedConfig.env ? Object.keys(resolvedConfig.env) : undefined
      })

      return resolvedConfig
    } catch (error) {
      logger.error('Failed to resolve MCP config:', error as Error)
      return null
    }
  }

  public cleanupPackageServer(serverName: string): boolean {
    try {
      const serverDirName = `server-${serverName}`
      const serverDir = ensurePathWithin(this.mcpDir, path.join(this.mcpDir, serverDirName))

      if (fs.existsSync(serverDir)) {
        logger.debug(`Removing package server directory: ${serverDir}`)
        fs.rmSync(serverDir, { recursive: true, force: true })
        return true
      }

      logger.warn(`Server directory not found: ${serverDir}`)
      return false
    } catch (error) {
      logger.error('Failed to cleanup package server:', error as Error)
      return false
    }
  }

  public cleanup() {
    try {
      // Clean up temp directory
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true })
      }
    } catch (error) {
      logger.error('Cleanup error:', error as Error)
    }
  }
}

export default McpPackageService
