import type { Editor } from '@tiptap/core'
import { Bot } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { serializeComposerDocument } from '@renderer/components/composer/composerDraft'
import type { ComposerSuggestionSource } from '@renderer/components/composer/quickPanel'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { getAgentAvatarFromConfiguration, getAgentDescriptionForDisplay } from '@renderer/utils/agent'

import { createAgentHandoffToken, isAgentHandoffToken } from './agentHandoffToken'

/** Adds `@agent` as an input-only handoff target. */
export function useAgentHandoffMentionSource(): ComposerSuggestionSource[] {
  const { t } = useTranslation()
  const { agents } = useAgents()
  return useMemo(
    () => [
      {
        pluginKey: 'agent-handoff-mention-suggestion',
        char: '@',
        title: t('agent.session.handoff.select_agent'),
        allowedPrefixes: [' ', '\n'],
        items: ({ query }) => {
          const normalized = query.trim().toLowerCase()
          return agents
            .filter((agent) => !normalized || agent.name.toLowerCase().includes(normalized))
            .map((agent) => {
              const item = {
                id: `agent-handoff:${agent.id}`,
                label: agent.name,
                description: getAgentDescriptionForDisplay(agent, t),
                icon: getAgentAvatarFromConfiguration(agent.configuration) || <Bot size={16} />,
                command: ({ editor: nextEditor }: { editor: Editor }) => {
                  const current = serializeComposerDocument(nextEditor)
                  const token = createAgentHandoffToken({
                    id: agent.id,
                    name: agent.name,
                    description: getAgentDescriptionForDisplay(agent, t)
                  })
                  const old = new Set(current.tokens.filter(isAgentHandoffToken).map((oldToken) => oldToken.id))
                  const ranges: Array<{ from: number; to: number }> = []
                  nextEditor.state.doc.descendants((node, position) => {
                    if (node.attrs.id && old.has(node.attrs.id))
                      ranges.push({ from: position, to: position + node.nodeSize })
                  })
                  const transaction = nextEditor.state.tr
                  for (const range of ranges.toReversed()) transaction.delete(range.from, range.to)
                  if (ranges.length > 0) nextEditor.view.dispatch(transaction)
                  nextEditor.chain().focus().insertComposerToken(token).insertContent(' ').run()
                }
              }
              return item
            })
        }
      }
    ],
    [agents, t]
  )
}
