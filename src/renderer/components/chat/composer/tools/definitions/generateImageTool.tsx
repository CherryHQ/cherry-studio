import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'
import { isGenerateImageModel } from '@renderer/config/models'
import { Image } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

const useGenerateImageToolController = (context) => {
  const { model, launcher, t } = context
  const [enabled, setEnabled] = useState(false)
  const isSupported = isGenerateImageModel(model)

  const handleToggle = useCallback(() => {
    if (!isSupported) return
    setEnabled((prev) => !prev)
  }, [isSupported])

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        id: 'generate-image',
        kind: 'command',
        sources: ['popover'],
        order: 20,
        label: t('chat.input.generate_image'),
        description: '',
        disabledReason: t('chat.input.generate_image_not_supported'),
        icon: <Image size={18} />,
        active: enabled && isSupported,
        disabled: !isSupported,
        action: handleToggle
      }
    ])
  }, [enabled, handleToggle, isSupported, launcher, t])

  return { enabled, handleToggle }
}

const GenerateImageComposerRuntime = ({ context }) => {
  useGenerateImageToolController(context)
  return null
}

const generateImageTool = defineTool({
  key: 'generate_image',
  label: (t) => t('chat.input.generate_image'),
  visibleInScopes: [TopicType.Chat],
  composer: {
    runtime: ({ context }) => <GenerateImageComposerRuntime context={context} />
  }
})

registerTool(generateImageTool)

export default generateImageTool
