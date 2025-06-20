import { FileType } from '@renderer/types'
import { useEffect } from 'react'

interface UseFileTokenManagerProps {
  files: FileType[]
  onFilesChange: (updatedFiles: FileType[]) => void
  estimateFileFunc: (file: FileType) => Promise<number>
}

export function useFileTokenManager({ files, onFilesChange, estimateFileFunc }: UseFileTokenManagerProps) {
  // 异步计算 tokens 并更新 files
  useEffect(() => {
    files.forEach(async (file) => {
      if (file.tokens !== undefined) return // 跳过已处理的文件
      try {
        const tokens = await estimateFileFunc(file) // 模拟异步计算
        onFilesChange(files.map((f) => (f.id === file.id ? { ...f, tokens } : f)))
      } catch (error) {
        console.error(`Failed to calculate token for ${file.name}:`, error)
      }
    })
  }, [files, onFilesChange, estimateFileFunc]) // 依赖外部传入的 files
}
