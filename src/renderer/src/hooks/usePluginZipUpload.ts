import { loggerService } from '@logger'
import type {
  InstallFromDirectoryOptions,
  InstallFromZipOptions,
  InstallFromZipResult,
  PluginResult
} from '@renderer/types/plugin'
import { getPluginErrorMessage } from '@renderer/utils/pluginErrors'
import { useCallback, useState } from 'react'

const logger = loggerService.withContext('usePluginZipUpload')

export interface UsePluginZipUploadOptions {
  agentId: string
  onSuccess?: (result: InstallFromZipResult) => void
  onError?: (error: string) => void
}

export interface UsePluginZipUploadResult {
  uploading: boolean
  uploadFromPath: (zipFilePath: string) => Promise<PluginResult<InstallFromZipResult>>
  uploadFromFile: (file: File) => Promise<PluginResult<InstallFromZipResult>>
  uploadFromDirectory: (directoryPath: string) => Promise<PluginResult<InstallFromZipResult>>
}

export function usePluginZipUpload(options: UsePluginZipUploadOptions): UsePluginZipUploadResult {
  const { agentId, onSuccess, onError } = options
  const [uploading, setUploading] = useState(false)

  const uploadFromPath = useCallback(
    async (zipFilePath: string): Promise<PluginResult<InstallFromZipResult>> => {
      setUploading(true)
      try {
        const installOptions: InstallFromZipOptions = {
          agentId,
          zipFilePath
        }
        const result = await window.api.claudeCodePlugin.installFromZip(installOptions)

        if (result.success) {
          onSuccess?.(result.data)
        } else {
          const errorMessage = getPluginErrorMessage(result.error, 'Failed to install plugin')
          onError?.(errorMessage)
        }

        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error('Failed to upload plugin ZIP', { error })
        onError?.(errorMessage)
        return {
          success: false,
          error: { type: 'TRANSACTION_FAILED', operation: 'upload-zip', reason: errorMessage }
        }
      } finally {
        setUploading(false)
      }
    },
    [agentId, onSuccess, onError]
  )

  const uploadFromFile = useCallback(
    async (file: File): Promise<PluginResult<InstallFromZipResult>> => {
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

  const uploadFromDirectory = useCallback(
    async (directoryPath: string): Promise<PluginResult<InstallFromZipResult>> => {
      setUploading(true)
      try {
        const installOptions: InstallFromDirectoryOptions = {
          agentId,
          directoryPath
        }
        const result = await window.api.claudeCodePlugin.installFromDirectory(installOptions)

        if (result.success) {
          onSuccess?.(result.data)
        } else {
          const errorMessage = getPluginErrorMessage(result.error, 'Failed to install plugin from directory')
          onError?.(errorMessage)
        }

        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error('Failed to install plugin from directory', { error })
        onError?.(errorMessage)
        return {
          success: false,
          error: { type: 'TRANSACTION_FAILED', operation: 'install-from-directory', reason: errorMessage }
        }
      } finally {
        setUploading(false)
      }
    },
    [agentId, onSuccess, onError]
  )

  return { uploading, uploadFromPath, uploadFromFile, uploadFromDirectory }
}
