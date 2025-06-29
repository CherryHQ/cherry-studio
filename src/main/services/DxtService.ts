import { getMcpDir, getTempDir } from '@main/utils/file'
import logger from 'electron-log'
import * as fs from 'fs'
import StreamZip from 'node-stream-zip'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'

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
      logger.error('[DxtService] Failed to create directories:', error)
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
      logger.info('[DxtService] Extracting DXT file:', filePath)

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
      const serverDirName = `server-${manifest.name}`
      const finalExtractDir = path.join(this.mcpDir, serverDirName)

      // Clean up any existing version of this server
      if (fs.existsSync(finalExtractDir)) {
        logger.info('[DxtService] Removing existing server directory:', finalExtractDir)
        fs.rmSync(finalExtractDir, { recursive: true, force: true })
      }

      // Move the temporary directory to the final location
      fs.renameSync(tempExtractDir, finalExtractDir)
      logger.info('[DxtService] DXT server extracted to:', finalExtractDir)

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
      logger.error('[DxtService] DXT upload error:', error)

      return {
        success: false,
        error: errorMessage
      }
    }
  }

  public cleanupDxtServer(serverName: string): boolean {
    try {
      const serverDirName = `server-${serverName}`
      const serverDir = path.join(this.mcpDir, serverDirName)

      if (fs.existsSync(serverDir)) {
        logger.info('[DxtService] Removing DXT server directory:', serverDir)
        fs.rmSync(serverDir, { recursive: true, force: true })
        return true
      }

      return false
    } catch (error) {
      logger.error('[DxtService] Failed to cleanup DXT server:', error)
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
      logger.error('[DxtService] Cleanup error:', error)
    }
  }
}

export default DxtService
