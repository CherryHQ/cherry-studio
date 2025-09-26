import { isVisionModel } from '@renderer/config/models'
import MentionModelsButton from '@renderer/pages/home/Inputbar/MentionModelsButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { getModelUniqId } from '@renderer/services/ModelService'
import { FileTypes, type Model } from '@renderer/types'
import { AtSign } from 'lucide-react'

const mentionModelsTool = defineTool({
  key: 'mention_models',
  label: (t) => t('agents.edit.model.select.title'),
  icon: AtSign,

  visibleInScopes: [TopicType.Chat, 'mini-window'],
  condition: ({ features }) => !!features.enableMentionModels,

  dependencies: {
    state: ['mentionedModels', 'files', 'couldMentionNotVisionModel'] as const,
    actions: ['setMentionedModels', 'setText'] as const
  },

  render: (context) => {
    const { state, actions, quickPanel } = context

    const onMentionModel = (model: Model) => {
      // Check if can mention non-vision model
      const couldMentionNotVisionModel = !state.files.some((file: any) => file.type === FileTypes.IMAGE)

      if (isVisionModel(model) || couldMentionNotVisionModel) {
        actions.setMentionedModels((prev: Model[]) => {
          const modelId = getModelUniqId(model)
          const exists = prev.some((m) => getModelUniqId(m) === modelId)
          return exists ? prev.filter((m) => getModelUniqId(m) !== modelId) : [...prev, model]
        })
      }
    }

    const onClearMentionModels = () => {
      actions.setMentionedModels([])
    }

    return (
      <MentionModelsButton
        quickPanel={quickPanel}
        mentionedModels={state.mentionedModels}
        onMentionModel={onMentionModel}
        onClearMentionModels={onClearMentionModels}
        couldMentionNotVisionModel={state.couldMentionNotVisionModel}
        files={state.files}
        setText={actions.setText}
      />
    )
  }
})

// Register the tool
registerTool(mentionModelsTool)

export default mentionModelsTool
