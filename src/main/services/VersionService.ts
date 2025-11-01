import { loggerService } from '@logger'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const logger = loggerService.withContext('VersionService')

type OS = 'win' | 'mac' | 'linux' | 'unknown'
type Environment = 'prod' | 'dev'
type Packaged = 'packaged' | 'unpackaged'
type Mode = 'install' | 'portable'

/**
 * Version record stored in version.log
 */
interface VersionRecord {
  version: string
  os: OS
  environment: Environment
  packaged: Packaged
  mode: Mode
  timestamp: string
}

/**
 * Service for tracking application version history
 * Stores version information in userData/version.log for data migration and diagnostics
 */
class VersionService {
  private readonly VERSION_LOG_FILE = 'version.log'
  private versionLogPath: string | null = null

  constructor() {
    // Lazy initialization of path since app.getPath may not be available during construction
  }

  /**
   * Gets the full path to version.log file
   * @returns {string} Full path to version log file
   */
  private getVersionLogPath(): string {
    if (!this.versionLogPath) {
      this.versionLogPath = path.join(app.getPath('userData'), this.VERSION_LOG_FILE)
    }
    return this.versionLogPath
  }

  /**
   * Gets current operating system identifier
   * @returns {OS} OS identifier
   */
  private getCurrentOS(): OS {
    switch (process.platform) {
      case 'win32':
        return 'win'
      case 'darwin':
        return 'mac'
      case 'linux':
        return 'linux'
      default:
        return 'unknown'
    }
  }

  /**
   * Gets current environment (production or development)
   * @returns {Environment} Environment identifier
   */
  private getCurrentEnvironment(): Environment {
    return import.meta.env.MODE === 'production' ? 'prod' : 'dev'
  }

  /**
   * Gets packaging status
   * @returns {Packaged} Packaging status
   */
  private getPackagedStatus(): Packaged {
    return app.isPackaged ? 'packaged' : 'unpackaged'
  }

  /**
   * Gets installation mode (install or portable)
   * @returns {Mode} Installation mode
   */
  private getInstallMode(): Mode {
    return process.env.PORTABLE_EXECUTABLE_DIR !== undefined ? 'portable' : 'install'
  }

  /**
   * Generates version log line for current application state
   * @returns {string} Pipe-separated version record line
   */
  private generateCurrentVersionLine(): string {
    const version = app.getVersion()
    const os = this.getCurrentOS()
    const environment = this.getCurrentEnvironment()
    const packaged = this.getPackagedStatus()
    const mode = this.getInstallMode()
    const timestamp = new Date().toISOString()

    return `${version}|${os}|${environment}|${packaged}|${mode}|${timestamp}`
  }

  /**
   * Parses a version log line into a VersionRecord object
   * @param {string} line - Pipe-separated version record line
   * @returns {VersionRecord | null} Parsed version record or null if invalid
   */
  private parseVersionLine(line: string): VersionRecord | null {
    try {
      const parts = line.trim().split('|')
      if (parts.length !== 6) {
        return null
      }

      const [version, os, environment, packaged, mode, timestamp] = parts

      // Validate data
      if (
        !version ||
        !['win', 'mac', 'linux', 'unknown'].includes(os) ||
        !['prod', 'dev'].includes(environment) ||
        !['packaged', 'unpackaged'].includes(packaged) ||
        !['install', 'portable'].includes(mode) ||
        !timestamp
      ) {
        return null
      }

      return {
        version,
        os: os as OS,
        environment: environment as Environment,
        packaged: packaged as Packaged,
        mode: mode as Mode,
        timestamp
      }
    } catch (error) {
      logger.warn(`Failed to parse version line: ${line}`, error as Error)
      return null
    }
  }

  /**
   * Reads the last 1KB from version.log and returns all lines
   * Uses reverse reading from file end to avoid reading the entire file
   * @returns {string[]} Array of version lines from the last 1KB
   */
  private readLastVersionLines(): string[] {
    const logPath = this.getVersionLogPath()

    try {
      if (!fs.existsSync(logPath)) {
        return []
      }

      const stats = fs.statSync(logPath)
      const fileSize = stats.size

      if (fileSize === 0) {
        return []
      }

      // Read from the end of the file, 1KB is enough to find previous version
      // Typical line: "1.7.0-beta.3|win|prod|packaged|install|2025-01-15T08:30:00.000Z\n" (~70 bytes)
      // 1KB can store ~14 lines, which is more than enough
      const bufferSize = Math.min(1024, fileSize)
      const buffer = Buffer.alloc(bufferSize)

      const fd = fs.openSync(logPath, 'r')
      try {
        const startPosition = Math.max(0, fileSize - bufferSize)
        fs.readSync(fd, buffer, 0, bufferSize, startPosition)

        const content = buffer.toString('utf-8')
        const lines = content.trim().split('\n').filter((line) => line.trim())

        return lines
      } finally {
        fs.closeSync(fd)
      }
    } catch (error) {
      logger.error('Failed to read version log:', error as Error)
      return []
    }
  }

  /**
   * Appends a version record line to version.log
   * @param {string} line - Version record line to append
   */
  private appendVersionLine(line: string): void {
    const logPath = this.getVersionLogPath()

    try {
      fs.appendFileSync(logPath, line + '\n', 'utf-8')
      logger.debug(`Version recorded: ${line}`)
    } catch (error) {
      logger.error('Failed to append version log:', error as Error)
    }
  }

  /**
   * Records the current version on application startup
   * Only adds a new record if the version has changed since the last run
   */
  recordCurrentVersion(): void {
    try {
      const currentLine = this.generateCurrentVersionLine()
      const lines = this.readLastVersionLines()

      // Add new record if this is the first run or version has changed
      if (lines.length === 0) {
        logger.info('First run detected, creating version log')
        this.appendVersionLine(currentLine)
        return
      }

      const lastLine = lines[lines.length - 1]
      const lastRecord = this.parseVersionLine(lastLine)
      const currentVersion = app.getVersion()

      if (!lastRecord || lastRecord.version !== currentVersion) {
        logger.info(`Version changed from ${lastRecord?.version || 'unknown'} to ${currentVersion}`)
        this.appendVersionLine(currentLine)
      } else {
        logger.debug(`Same version ${currentVersion}, skip recording`)
      }
    } catch (error) {
      logger.error('Failed to record current version:', error as Error)
    }
  }

  /**
   * Gets the previous version record (last record with different version than current)
   * Reads from the last 1KB of version.log to find the most recent different version
   * Useful for detecting version upgrades and running migrations
   * @returns {VersionRecord | null} Previous version record or null if not available
   */
  getPreviousVersion(): VersionRecord | null {
    try {
      const lines = this.readLastVersionLines()
      if (lines.length === 0) {
        return null
      }

      const currentVersion = app.getVersion()

      // Read from the end backwards to find the first different version
      for (let i = lines.length - 1; i >= 0; i--) {
        const record = this.parseVersionLine(lines[i])
        if (record && record.version !== currentVersion) {
          return record
        }
      }

      return null
    } catch (error) {
      logger.error('Failed to get previous version:', error as Error)
      return null
    }
  }
}

/**
 * Singleton instance of VersionService
 */
export const versionService = new VersionService()
