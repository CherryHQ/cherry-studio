import { estimateImageTokens, estimateTextFileTokensByPath } from '@renderer/services/TokenService'
import { FileType, FileTypes } from '@renderer/types'
import { useEffect } from 'react'

interface UseFileTokenManagerProps {
  files: FileType[]
  onFilesChange: (updatedFiles: FileType[]) => void
}

export function useFileTokenManager({ files, onFilesChange }: UseFileTokenManagerProps) {
  // 异步计算 tokens 并更新 files
  useEffect(() => {
    files.forEach(async (file) => {
      if (file.tokens !== undefined) return // 跳过已处理的文件
      try {
        if (file.type === FileTypes.IMAGE) {
          const tokens = estimateImageTokens(file)
          onFilesChange(files.map((f) => (f.id === file.id ? { ...f, tokens } : f)))
        } else if (file.type === FileTypes.TEXT) {
          const tokens = await estimateTextFileTokensByPath(file)
          onFilesChange(files.map((f) => (f.id === file.id ? { ...f, tokens } : f)))
        }
        // 跳过非文本文件和图片的文件
      } catch (error) {
        console.error(`Failed to calculate token for ${file.name}:`, error)
      }
    }) // 依赖外部传入的 files
  }, [files, onFilesChange])
}
