import { Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import type { VideoGenerationMode } from '@shared/data/types/model'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { creationClasses } from '../../creationPrimitives'

const VIDEO_MODE_LABEL_KEYS: Record<VideoGenerationMode, string> = {
  t2v: 'paintings.video.mode_options.t2v',
  i2v: 'paintings.video.mode_options.i2v',
  keyframe: 'paintings.video.mode_options.keyframe',
  reference: 'paintings.video.mode_options.reference',
  extend: 'paintings.video.mode_options.extend',
  edit: 'paintings.video.mode_options.edit',
  multishot: 'paintings.video.mode_options.multishot'
}

interface VideoModePillsProps {
  /** The model's registry-declared modes, in declaration order. */
  modes: VideoGenerationMode[]
  mode: VideoGenerationMode
  onChange: (mode: VideoGenerationMode) => void
  disabled?: boolean
}

/**
 * Compact generation-mode switcher (t2v / i2v / …) for the video composer's
 * bottom toolbar. Registry-driven: hidden when the selected model declares at
 * most one mode.
 */
const VideoModePills: FC<VideoModePillsProps> = ({ modes, mode, onChange, disabled }) => {
  const { t } = useTranslation()

  if (modes.length <= 1) return null

  return (
    <Tabs value={mode} onValueChange={(value) => onChange(value as VideoGenerationMode)}>
      <TabsList className={creationClasses.promptModeTabsList}>
        {modes.map((m) => (
          <TabsTrigger key={m} value={m} disabled={disabled} className={creationClasses.promptModeTabsTrigger}>
            {t(VIDEO_MODE_LABEL_KEYS[m], m)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

export default VideoModePills
