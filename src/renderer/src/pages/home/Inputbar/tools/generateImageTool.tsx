import { isGenerateImageModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import GenerateImageButton from '@renderer/pages/home/Inputbar/GenerateImageButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { useCallback } from 'react'

const GenerateImageTool = ({ context }) => {
  const { assistant, model } = context
  const { updateAssistant } = useAssistant(assistant.id)

  const handleToggle = useCallback(() => {
    updateAssistant({ id: assistant.id, enableGenerateImage: !assistant.enableGenerateImage })
  }, [assistant.enableGenerateImage, assistant.id, updateAssistant])

  return <GenerateImageButton assistant={assistant} model={model} onEnableGenerateImage={handleToggle} />
}

const generateImageTool = defineTool({
  key: 'generate_image',
  label: (t) => t('chat.input.generate_image'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ features, model }) => features.enableGenImage && isGenerateImageModel(model),
  render: (context) => <GenerateImageTool context={context} />
})

registerTool(generateImageTool)

export default generateImageTool
