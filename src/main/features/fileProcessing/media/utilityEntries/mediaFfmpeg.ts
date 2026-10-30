import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'
import type { MediaFfmpegContract, MediaFfmpegInitData } from '@main/features/fileProcessing/media/mediaFfmpegProcess'

import { applyMediaFfmpegInitData, disposeMediaChildren, mediaFfmpegHandlers } from './mediaFfmpegHandlers'

serveUtilityProcess<MediaFfmpegContract, MediaFfmpegInitData>({
  id: 'media.ffmpeg',
  initialize: applyMediaFfmpegInitData,
  handlers: mediaFfmpegHandlers,
  dispose: ({ logger }) => disposeMediaChildren(logger)
})
