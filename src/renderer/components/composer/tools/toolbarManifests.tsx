import { MdiLightbulbQuestion } from '@renderer/components/icons/SvgIcon'
import type { TFunction } from 'i18next'
import { FileSearch, Globe, Image, Paperclip, Pointer, Zap } from 'lucide-react'

import { type ComposerToolScope, type ToolComposerToolbarContribution, TopicType } from './types'

interface ComposerToolbarManifestDefinition {
  toolbar: ToolComposerToolbarContribution
  label: (t: TFunction) => string
  visibleInScopes: ComposerToolScope[]
}

export interface ComposerToolbarManifest extends ToolComposerToolbarContribution {
  label: string
}

export const ATTACHMENT_TOOLBAR_MANIFEST: ComposerToolbarManifestDefinition = {
  toolbar: {
    id: 'attachment',
    kind: 'dialog',
    order: 10,
    icon: <Paperclip />
  },
  label: (t) => t('chat.input.upload.attachment'),
  visibleInScopes: [TopicType.Chat, TopicType.Session, 'quick-assistant', 'painting']
}

export const GENERATE_IMAGE_TOOLBAR_MANIFEST: ComposerToolbarManifestDefinition = {
  toolbar: {
    id: 'generate-image',
    kind: 'command',
    order: 20,
    icon: <Image size={18} />
  },
  label: (t) => t('chat.input.generate_image'),
  visibleInScopes: [TopicType.Chat]
}

export const WEB_SEARCH_TOOLBAR_MANIFEST: ComposerToolbarManifestDefinition = {
  toolbar: {
    id: 'web-search',
    kind: 'command',
    order: 30,
    icon: <Globe />
  },
  label: (t) => t('chat.input.web_search.label'),
  visibleInScopes: [TopicType.Chat]
}

export const KNOWLEDGE_BASE_TOOLBAR_MANIFEST: ComposerToolbarManifestDefinition = {
  toolbar: {
    id: 'knowledge-base',
    kind: 'panel',
    order: 40,
    icon: <FileSearch />
  },
  label: (t) => t('chat.input.knowledge_base'),
  visibleInScopes: [TopicType.Chat]
}

export const THINKING_TOOLBAR_MANIFEST: ComposerToolbarManifestDefinition = {
  toolbar: {
    id: 'thinking',
    kind: 'group',
    order: 60,
    icon: <MdiLightbulbQuestion className="icon" width={18} height={18} style={{ marginTop: -2 }} />
  },
  label: (t) => t('assistants.settings.reasoning_effort.label'),
  visibleInScopes: [TopicType.Chat, TopicType.Session]
}

export const QUICK_PHRASES_TOOLBAR_MANIFEST: ComposerToolbarManifestDefinition = {
  toolbar: {
    id: 'quick-phrases',
    kind: 'panel',
    order: 70,
    icon: <Zap />
  },
  label: (t) => t('settings.prompts.title'),
  visibleInScopes: [TopicType.Chat, TopicType.Session, 'quick-assistant', 'painting']
}

export const PERMISSION_MODE_TOOLBAR_MANIFEST: ComposerToolbarManifestDefinition = {
  toolbar: {
    id: 'permission-mode',
    kind: 'group',
    order: 80,
    icon: <Pointer size={18} color="#00b96b" />
  },
  label: (t) => t('agent.settings.permissionMode.title', 'Permission Mode'),
  visibleInScopes: [TopicType.Session]
}

const COMPOSER_TOOLBAR_MANIFESTS: ComposerToolbarManifestDefinition[] = [
  ATTACHMENT_TOOLBAR_MANIFEST,
  GENERATE_IMAGE_TOOLBAR_MANIFEST,
  WEB_SEARCH_TOOLBAR_MANIFEST,
  KNOWLEDGE_BASE_TOOLBAR_MANIFEST,
  THINKING_TOOLBAR_MANIFEST,
  QUICK_PHRASES_TOOLBAR_MANIFEST,
  PERMISSION_MODE_TOOLBAR_MANIFEST
]

/**
 * Returns scope-only toolbar metadata without importing tool runtimes or
 * evaluating model-dependent conditions.
 */
export const getComposerToolbarManifestsForScope = (
  scope: ComposerToolScope,
  t: TFunction
): ComposerToolbarManifest[] =>
  COMPOSER_TOOLBAR_MANIFESTS.filter((manifest) => manifest.visibleInScopes.includes(scope))
    .map((manifest) => ({
      ...manifest.toolbar,
      label: manifest.label(t)
    }))
    .sort((left, right) => left.order - right.order)
