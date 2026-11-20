import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ChatConversationControls } from '../ChatConversationControls'

vi.mock('@renderer/components/cherryCloud/CherryCloudModelSelector', () => ({
  CherryCloudModelSelector: ({ trigger }: { trigger: React.ReactNode }) => trigger
}))

const renderControls = (props: { assistantEmoji?: string; assistantAvatarSrc?: string }) =>
  render(
    <ChatConversationControls
      assistantId="assistant-1"
      assistantName="Translator"
      providers={[]}
      mentionedModels={[]}
      mentionedModelSelectorValue={[]}
      lockedMentionedModels={[]}
      mentionedModelMultiSelectMode={false}
      selectModelLabel="Select model"
      shouldAutoSelectCreatedAssistant={false}
      assistantTriggerAction="edit"
      side="bottom"
      onAssistantChange={vi.fn()}
      onModelSelect={vi.fn()}
      onMentionedModelsSelect={vi.fn()}
      onMentionedModelMultiSelectModeChange={vi.fn()}
      onMentionedModelSelectorRestore={vi.fn()}
      {...props}
    />
  )

describe('ChatConversationControls', () => {
  // An Assistant keeps its emoji after an image upload, so the header must not prefer the emoji.
  it("shows the Assistant's uploaded avatar instead of its emoji", () => {
    renderControls({ assistantEmoji: '📧', assistantAvatarSrc: 'file:///avatars/translator.webp' })

    const trigger = screen.getByRole('button', { name: /Translator/ })
    expect(trigger.querySelector('img')).toHaveAttribute('src', 'file:///avatars/translator.webp')
    expect(trigger).not.toHaveTextContent('📧')
  })

  it('shows the emoji when the Assistant has no uploaded avatar', () => {
    renderControls({ assistantEmoji: '📧' })

    const trigger = screen.getByRole('button', { name: /Translator/ })
    expect(trigger.querySelector('img')).toBeNull()
    expect(trigger).toHaveTextContent('📧')
  })
})
