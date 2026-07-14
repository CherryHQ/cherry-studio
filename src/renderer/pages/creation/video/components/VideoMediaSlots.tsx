import type { FileEntry } from '@shared/data/types/file'
import type { VideoModeDef } from '@shared/data/types/model'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import VideoMediaInput from './VideoMediaInput'

interface VideoMediaSlotsProps {
  /** The active mode's registry `mediaInputs` block — declares which slots exist. */
  mediaInputs?: VideoModeDef['mediaInputs']
  firstFrame?: FileEntry
  lastFrame?: FileEntry
  disabled?: boolean
  onFirstFrameChange: (entry?: FileEntry) => void
  onLastFrameChange: (entry?: FileEntry) => void
}

/**
 * Registry-driven media placeholder row for the video composer — rendered in
 * the composer header, above the textarea. The selected model+mode's
 * `mediaInputs` decides which insertion placeholders appear; nothing is
 * rendered when the mode declares none (t2v).
 *
 * Forward design: `referenceImages: { max }` later appends up to `max` dynamic
 * single-image descriptors to the same row (filled entries + one empty picker),
 * and `inputVideo` / `inputAudio` become descriptors with different `accept`
 * values — the row contract (a list of single-file slots) already accommodates
 * them; they are not built until the UI surfaces them.
 */
const VideoMediaSlots: FC<VideoMediaSlotsProps> = ({
  mediaInputs,
  firstFrame,
  lastFrame,
  disabled,
  onFirstFrameChange,
  onLastFrameChange
}) => {
  const { t } = useTranslation()

  if (!mediaInputs?.firstFrame && !mediaInputs?.lastFrame) return null

  const slots: Array<{
    key: string
    label: string
    value?: FileEntry
    onChange: (entry?: FileEntry) => void
  }> = []
  if (mediaInputs.firstFrame) {
    slots.push({
      key: 'firstFrame',
      label: t('paintings.video.first_frame'),
      value: firstFrame,
      onChange: onFirstFrameChange
    })
  }
  if (mediaInputs.lastFrame) {
    slots.push({
      key: 'lastFrame',
      label: t('paintings.video.last_frame'),
      value: lastFrame,
      onChange: onLastFrameChange
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {slots.map((slot) => (
        <VideoMediaInput
          key={slot.key}
          label={slot.label}
          value={slot.value}
          disabled={disabled}
          onChange={slot.onChange}
        />
      ))}
    </div>
  )
}

export default VideoMediaSlots
