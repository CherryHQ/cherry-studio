import type { UIMessage } from 'ai'

import type { AiPlugin } from '@cherrystudio/ai-core'
import { readCherryMeta } from '@shared/data/types/uiParts'

export interface IllustrationInput {
  reference: string
  id: string
  name: string
}

/** Runs after context shaping, including on model fallbacks, so summaries cannot authorize images. */
export function createIllustrationInputsPlugin(
  getInputs: () => readonly IllustrationInput[],
  sink: (inputs: IllustrationInput[]) => void
): AiPlugin {
  return {
    name: 'illustration-inputs',
    enforce: 'post',
    configureContext(context) {
      const middlewares = (context.middlewares ??= [])
      middlewares.push({
        specificationVersion: 'v3',
        transformParams: async ({ params }) => {
          const visible = new Set(
            params.prompt.flatMap((message) =>
              message.role === 'user'
                ? message.content.flatMap((part) =>
                    part.type === 'file' && part.mediaType.startsWith('image/')
                      ? [part.providerOptions?.cherry?.fileEntryId]
                      : []
                  )
                : []
            )
          )
          sink(getInputs().filter((input) => visible.has(input.id)))
          return params
        }
      })
    }
  }
}

/** Label only materialized user images; retained attachment manifests are not image inputs. */
export function prepareIllustrationInputs(messages: UIMessage[]): {
  messages: UIMessage[]
  inputs: IllustrationInput[]
} {
  const inputs = new Map<string, IllustrationInput>()
  const prepared = messages.map((message) => {
    if (message.role !== 'user') return message
    const parts = message.parts.flatMap((part): UIMessage['parts'] => {
      if (part.type !== 'file' || !part.mediaType.startsWith('image/')) return [part]
      const id = readCherryMeta(part)?.fileEntryId
      if (!id) return [part]
      let input = inputs.get(id)
      if (!input) {
        input = { reference: `image_${inputs.size + 1}`, id, name: part.filename ?? 'image' }
        inputs.set(id, input)
      }
      return [
        {
          type: 'text',
          text: `Illustration reference ${input.reference}: ${JSON.stringify(input.name)} (following image)`
        },
        part
      ]
    })
    return { ...message, parts }
  })
  return { messages: prepared, inputs: [...inputs.values()] }
}
