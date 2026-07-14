import { AttachmentToolRuntime } from '@renderer/components/composer/tools/components/AttachmentButton'
import { defineTool, TopicType } from '@renderer/components/composer/tools/types'
import { isGenerateVideoModel } from '@shared/utils/model'

import { composerFileTokenId, getComposerTokenIds } from '../../variants/shared/composerTokens'

const attachmentTool = defineTool({
  key: 'attachment',
  label: (t) => t('chat.input.upload.image_or_document'),

  visibleInScopes: [TopicType.Chat, TopicType.Session, 'quick-assistant', 'creation'],

  // The Creation page's video mode uses registry-driven media SLOTS (first/last
  // frame placeholders in the composer header), not the flat attachment list —
  // roles matter there. Hide the "+" attachment entry for video models; image
  // models keep the pipeline (edit-input images).
  condition: ({ scope, model }) => scope !== 'creation' || !isGenerateVideoModel(model),

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
    },
    // Editor→state: keep only files still present as a file token, deduping by token id in one
    // pass (folds the variants' separate prune + dedup effect into the file-owning tool).
    tokens: {
      reconcile: (draftTokens, { actions }) => {
        const fileTokenIds = getComposerTokenIds(draftTokens, 'file')
        actions.setFiles?.((prev) => {
          const seen = new Set<string>()
          const next: typeof prev = []
          let changed = false
          for (const file of prev) {
            const id = composerFileTokenId(file)
            if (!fileTokenIds.has(id) || seen.has(id)) {
              changed = true
              continue
            }
            seen.add(id)
            next.push(file)
          }
          return changed ? next : prev
        })
      }
    }
  }
})

// Register the tool

export default attachmentTool
