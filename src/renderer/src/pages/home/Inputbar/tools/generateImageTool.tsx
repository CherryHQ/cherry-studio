import { isGenerateImageModel } from '@renderer/config/models'
import GenerateImageButton from '@renderer/pages/home/Inputbar/tools/components/GenerateImageButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { useCallback, useState } from 'react'

const GenerateImageTool = ({ context }) => {
  const { model } = context
  const [enabled, setEnabled] = useState(false)

  const handleToggle = useCallback(() => {
    setEnabled((prev) => !prev)
  }, [])

  return <GenerateImageButton enabled={enabled} model={model} onEnableGenerateImage={handleToggle} />
}

const generateImageTool = defineTool({
  key: 'generate_image',
  label: (t) => t('chat.input.generate_image'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ model }) => isGenerateImageModel(model),
  render: (context) => <GenerateImageTool context={context} />
})

registerTool(generateImageTool)

export default generateImageTool
