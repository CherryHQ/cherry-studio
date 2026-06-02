import { AttachmentToolRuntime } from '@renderer/components/chat/composer/tools/components/AttachmentButton'
import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'

const attachmentTool = defineTool({
  key: 'attachment',
  label: (t) => t('chat.input.upload.image_or_document'),

  visibleInScopes: [TopicType.Chat, TopicType.Session, 'quick-assistant'],

  dependencies: {
    state: ['files', 'couldAddImageFile', 'extensions'] as const,
    actions: ['setFiles'] as const
  },

  composer: {
    runtime: ({ context }) => {
      const { state, actions, launcher } = context

      return (
        <AttachmentToolRuntime
          launcher={launcher}
          couldAddImageFile={state.couldAddImageFile}
          extensions={state.extensions}
          files={state.files}
          setFiles={actions.setFiles}
        />
      )
    }
  }
})

// Register the tool
registerTool(attachmentTool)

export default attachmentTool
