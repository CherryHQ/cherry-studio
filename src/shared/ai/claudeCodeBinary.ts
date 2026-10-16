export interface ClaudeCodeBinaryStatus {
  version: string
  phase: 'missing' | 'downloading' | 'installing' | 'ready' | 'error'
  receivedBytes: number
  totalBytes?: number
  error?: 'network' | 'integrity' | 'storage' | 'unsupported' | 'installation'
}
