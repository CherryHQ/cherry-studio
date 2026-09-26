export type VideoStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface Video {
  id: string
  providerId: string
  modelId: string
  prompt: string
  duration?: number | null
  resolution?: string | null
  status: VideoStatus
  providerTaskId?: string | null
  videoUrl?: string | null
  errorMessage?: string | null
  jobId?: string | null
  createdAt: number
  updatedAt: number
}
