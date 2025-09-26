import AttachmentButton from '@renderer/pages/home/Inputbar/AttachmentButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { Paperclip } from 'lucide-react'

const attachmentTool = defineTool({
  key: 'attachment',
  label: (t) => t('chat.input.upload.image_or_document'),
  icon: Paperclip,

  visibleInScopes: [TopicType.Chat, 'mini-window'],
  condition: ({ features }) => !!features.enableAttachments,

  dependencies: {
    state: ['files', 'couldAddImageFile', 'extensions'] as const,
    actions: ['setFiles'] as const
  },

  render: (context) => {
    const { state, actions, quickPanel } = context

    return (
      <AttachmentButton
        quickPanel={quickPanel}
        couldAddImageFile={state.couldAddImageFile}
        extensions={state.extensions}
        files={state.files}
        setFiles={actions.setFiles}
      />
    )
  }
})

// Register the tool
registerTool(attachmentTool)

export default attachmentTool
