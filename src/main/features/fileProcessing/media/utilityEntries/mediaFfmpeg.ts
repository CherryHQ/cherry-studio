/**
 * Media FFmpeg utility-process entry. Keep this file to serveUtilityProcess wiring only.
 */

import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'
import type { MediaFfmpegContract, MediaProcessInitData } from '@main/features/fileProcessing/media/mediaProcess'

import { applyMediaInitData, disposeMediaChildren, mediaFfmpegHandlers } from './mediaFfmpegHandlers'

serveUtilityProcess<MediaFfmpegContract, MediaProcessInitData>({
  id: 'media.ffmpeg',
  initialize: (initData) => applyMediaInitData(initData),
  handlers: mediaFfmpegHandlers,
  dispose: ({ logger }) => disposeMediaChildren(logger)
})
