import { createContext, use } from 'react'

import type { useAssistant } from '@renderer/hooks/useAssistant'

type ComposerAssistant = Pick<ReturnType<typeof useAssistant>, 'assistant' | 'model' | 'updateAssistant'>

// Alternate conversation surfaces can keep the same controls with a different settings owner.
export const ComposerAssistantContext = createContext<ComposerAssistant | null>(null)
export const useComposerAssistant = () => use(ComposerAssistantContext)
