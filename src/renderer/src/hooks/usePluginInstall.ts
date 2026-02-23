import { loggerService } from '@logger'
import type { InstallFromSourceResult, PluginError, PluginResult } from '@renderer/types/plugin'
import { getPluginErrorMessage } from '@renderer/utils/pluginErrors'
import { useCallback, useState } from 'react'

const logger = loggerService.withContext('usePluginInstall')

export interface UsePluginInstallOptions {
  agentId: string
  onSuccess?: (result: InstallFromSourceResult) => void
  onError?: (error: string) => void
}

export interface UsePluginInstallResult {
  uploading: boolean
  uploadFromPath: (zipFilePath: string) => Promise<PluginResult<InstallFromSourceResult>>
  uploadFromFile: (file: File) => Promise<PluginResult<InstallFromSourceResult>>
  uploadFromDirectory: (directoryPath: string) => Promise<PluginResult<InstallFromSourceResult>>
}

export function usePluginInstall(options: UsePluginInstallOptions): UsePluginInstallResult {
  const { agentId, onSuccess, onError } = options
  const [uploading, setUploading] = useState(false)

  /**
   * Execute an install operation with shared error handling
   */
  const executeInstall = useCallback(
    async <TOptions>(
      installFn: (opts: TOptions) => Promise<PluginResult<InstallFromSourceResult>>,
      installOptions: TOptions,
      operationName: string
    ): Promise<PluginResult<InstallFromSourceResult>> => {
      setUploading(true)
      try {
        const result = await installFn(installOptions)

        if (result.success) {
          onSuccess?.(result.data)
        } else {
          onError?.(getPluginErrorMessage(result.error, `Failed to ${operationName}`))
        }

        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error(`Failed to ${operationName}`, { error })
        onError?.(errorMessage)
        return {
          success: false,
          error: { type: 'TRANSACTION_FAILED', operation: operationName, reason: errorMessage } as PluginError
        }
      } finally {
        setUploading(false)
      }
    },
    [onSuccess, onError]
  )

  const uploadFromPath = useCallback(
    (zipFilePath: string) =>
      executeInstall(window.api.claudeCodePlugin.installFromZip, { agentId, zipFilePath }, 'install plugin'),
    [agentId, executeInstall]
  )

  const uploadFromDirectory = useCallback(
    (directoryPath: string) =>
      executeInstall(
        window.api.claudeCodePlugin.installFromDirectory,
        { agentId, directoryPath },
        'install plugin from directory'
      ),
    [agentId, executeInstall]
  )

  const uploadFromFile = useCallback(
    async (file: File): Promise<PluginResult<InstallFromSourceResult>> => {
      const filePath = window.api.file.getPathForFile(file)
      if (!filePath) {
        const error = 'Failed to get file path'
        onError?.(error)
        return {
          success: false,
          error: { type: 'FILE_NOT_FOUND', path: file.name }
        }
      }
      return uploadFromPath(filePath)
    },
    [uploadFromPath, onError]
  )

  return { uploading, uploadFromPath, uploadFromFile, uploadFromDirectory }
}
