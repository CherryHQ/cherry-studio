import type { VideoModel } from '@cherrystudio/openai/resources'
import { videoModelsMap } from '@renderer/config/models/video'

// Only for openai, use hard-encoded values
export const isVideoModel = (modelId: string): modelId is VideoModel => {
  return videoModelsMap.openai.some((v) => v === modelId)
}
