import { loggerService } from '@logger'
import { getMcpDir, getTempDir } from '@main/utils/file'
import * as fs from 'fs'
import StreamZip from 'node-stream-zip'
import * as os from 'os'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('DxtService')

// Type definitions
export interface DxtManifest {
  dxt_version: string
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

export interface DxtUploadResult {
  success: boolean
  data?: {
    manifest: DxtManifest
    extractDir: string
  }
  error?: string
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
  result = result.replace(/\$\{HOME\}/g, os.homedir())

  // Replace ${DESKTOP} with user's desktop directory
  const desktopDir = path.join(os.homedir(), 'Desktop')
  result = result.replace(/\$\{DESKTOP\}/g, desktopDir)

  // Replace ${DOCUMENTS} with user's documents directory
  const documentsDir = path.join(os.homedir(), 'Documents')
  result = result.replace(/\$\{DOCUMENTS\}/g, documentsDir)

  // Replace ${DOWNLOADS} with user's downloads directory
  const downloadsDir = path.join(os.homedir(), 'Downloads')
  result = result.replace(/\$\{DOWNLOADS\}/g, downloadsDir)

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

export function applyPlatformOverrides(mcpConfig: any, extractDir: string, userConfig?: Record<string, any>): any {
  const platform = process.platform
  const resolvedConfig = { ...mcpConfig }

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
  }

  if (resolvedConfig.args) {
    resolvedConfig.args = resolvedConfig.args.map((arg: string) =>
      performVariableSubstitution(arg, extractDir, userConfig)
    )
  }

  if (resolvedConfig.env) {
    for (const [key, value] of Object.entries(resolvedConfig.env)) {
      resolvedConfig.env[key] = performVariableSubstitution(value as string, extractDir, userConfig)
    }
  }

  return resolvedConfig
}

export interface ResolvedMcpConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

class DxtService {
  private tempDir = path.join(getTempDir(), 'dxt_uploads')
  private mcpDir = getMcpDir()

  constructor() {
    this.ensureDirectories()
  }

  private ensureDirectories() {
    try {
      // Create temp directory
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true })
      }
      // Create MCP directory
      if (!fs.existsSync(this.mcpDir)) {
        fs.mkdirSync(this.mcpDir, { recursive: true })
      }
    } catch (error) {
      logger.error('Failed to create directories:', error as Error)
    }
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

  public async uploadDxt(_: Electron.IpcMainInvokeEvent, filePath: string): Promise<DxtUploadResult> {
    const tempExtractDir = path.join(this.tempDir, `dxt_${uuidv4()}`)

    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error('DXT file not found')
      }

      // Extract the DXT file (which is a ZIP archive) to a temporary directory
      logger.debug(`Extracting DXT file: ${filePath}`)

      const zip = new StreamZip.async({ file: filePath })
      await zip.extract(null, tempExtractDir)
      await zip.close()

      // Read and validate the manifest.json
      const manifestPath = path.join(tempExtractDir, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        throw new Error('manifest.json not found in DXT file')
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
      const manifest: DxtManifest = JSON.parse(manifestContent)

      // Validate required fields in manifest
      if (!manifest.dxt_version) {
        throw new Error('Invalid manifest: missing dxt_version')
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
      // Sanitize the name to prevent creating subdirectories
      const sanitizedName = manifest.name.replace(/\//g, '-')
      const serverDirName = `server-${sanitizedName}`
      const finalExtractDir = path.join(this.mcpDir, serverDirName)

      // Clean up any existing version of this server
      if (fs.existsSync(finalExtractDir)) {
        logger.debug(`Removing existing server directory: ${finalExtractDir}`)
        fs.rmSync(finalExtractDir, { recursive: true, force: true })
      }

      // Move the temporary directory to the final location
      // Use recursive copy + remove instead of rename to handle cross-filesystem moves
      await this.moveDirectory(tempExtractDir, finalExtractDir)
      logger.debug(`DXT server extracted to: ${finalExtractDir}`)

      // Clean up the uploaded DXT file if it's in temp directory
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

      const errorMessage = error instanceof Error ? error.message : 'Failed to process DXT file'
      logger.error('DXT upload error:', error as Error)

      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * Get resolved MCP configuration for a DXT server with platform overrides and variable substitution
   */
  public getResolvedMcpConfig(dxtPath: string, userConfig?: Record<string, any>): ResolvedMcpConfig | null {
    try {
      // Read the manifest from the DXT server directory
      const manifestPath = path.join(dxtPath, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        logger.error(`Manifest not found: ${manifestPath}`)
        return null
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
      const manifest: DxtManifest = JSON.parse(manifestContent)

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

  public cleanupDxtServer(serverName: string): boolean {
    try {
      // Handle server names that might contain slashes (e.g., "anthropic/sequential-thinking")
      // by replacing slashes with the same separator used during installation
      const sanitizedName = serverName.replace(/\//g, '-')
      const serverDirName = `server-${sanitizedName}`
      const serverDir = path.join(this.mcpDir, serverDirName)

      // First try the sanitized path
      if (fs.existsSync(serverDir)) {
        logger.debug(`Removing DXT server directory: ${serverDir}`)
        fs.rmSync(serverDir, { recursive: true, force: true })
        return true
      }

      // Fallback: try with original name in case it was stored differently
      const originalServerDir = path.join(this.mcpDir, `server-${serverName}`)
      if (fs.existsSync(originalServerDir)) {
        logger.debug(`Removing DXT server directory: ${originalServerDir}`)
        fs.rmSync(originalServerDir, { recursive: true, force: true })
        return true
      }

      logger.warn(`Server directory not found: ${serverDir}`)
      return false
    } catch (error) {
      logger.error('Failed to cleanup DXT server:', error as Error)
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

export default DxtService
