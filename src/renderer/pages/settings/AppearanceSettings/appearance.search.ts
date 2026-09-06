import type { SettingsSearchEntry } from '../settingsSearch/types'

// Indexed rows = statically visible actionable rows (D8). Platform-gated rows
// (system title bar on Linux, transparent window on macOS) and config-gated
// rows (code-execution timeout, code-editor sub-switches) stay out — their
// anchors may not exist when jumping.
export const route = '/settings/appearance'

const inputGroup = 'settings.messages.input.title'
const messagesGroup = 'settings.messages.title'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'theme-mode',
    titleKey: 'settings.theme.title',
    groupKey: 'settings.theme.title',
    aliases: ['dark mode', '深色模式', '浅色模式', 'light mode']
  },
  {
    anchorId: 'theme-color-primary',
    titleKey: 'settings.theme.color_primary',
    groupKey: 'settings.theme.title'
  },
  {
    anchorId: 'display-language',
    titleKey: 'common.language',
    groupKey: 'settings.general.common.sections.display_language',
    aliases: ['language', '语言']
  },
  {
    anchorId: 'zoom',
    titleKey: 'settings.zoom.title',
    groupKey: 'settings.general.common.sections.display_language'
  },
  {
    anchorId: 'menu-presentation-mode',
    titleKey: 'settings.general.common.menu.presentation_mode.title',
    groupKey: 'settings.general.common.sections.display_language'
  },
  {
    anchorId: 'chat-list-position',
    titleKey: 'settings.display.list_position.chat',
    groupKey: 'settings.general.common.sections.display_language'
  },
  {
    anchorId: 'work-list-position',
    titleKey: 'settings.display.list_position.work',
    groupKey: 'settings.general.common.sections.display_language'
  },
  {
    anchorId: 'font-global',
    titleKey: 'settings.display.font.global',
    groupKey: 'settings.display.font.title'
  },
  {
    anchorId: 'font-code',
    titleKey: 'settings.display.font.code',
    groupKey: 'settings.display.font.title'
  },
  {
    anchorId: 'code-execution-enabled',
    titleKey: 'chat.settings.code_execution.title',
    groupKey: 'chat.settings.code_execution.title'
  },
  {
    anchorId: 'code-image-tools',
    titleKey: 'chat.settings.code_image_tools.label',
    groupKey: 'chat.settings.code_execution.title'
  },
  {
    anchorId: 'custom-css',
    titleKey: 'settings.display.custom.css.label',
    groupKey: 'settings.display.custom.css.label',
    aliases: ['css']
  },
  {
    anchorId: 'send-shortcuts',
    titleKey: 'settings.messages.input.send_shortcuts',
    groupKey: inputGroup
  },
  {
    anchorId: 'newline-shortcuts',
    titleKey: 'settings.messages.input.newline_shortcuts',
    groupKey: inputGroup
  },
  {
    anchorId: 'steer-shortcuts',
    titleKey: 'settings.messages.input.steer_shortcuts',
    groupKey: inputGroup
  },
  {
    anchorId: 'spell-check',
    titleKey: 'settings.general.spell_check.label',
    groupKey: inputGroup
  },
  {
    anchorId: 'show-estimated-tokens',
    titleKey: 'settings.messages.input.show_estimated_tokens',
    groupKey: inputGroup
  },
  {
    anchorId: 'markdown-rendering-input-message',
    titleKey: 'settings.messages.markdown_rendering_input_message',
    groupKey: inputGroup
  },
  {
    anchorId: 'confirm-delete-message',
    titleKey: 'settings.messages.input.confirm_delete_message',
    groupKey: inputGroup
  },
  {
    anchorId: 'wide-mode',
    titleKey: 'settings.messages.wide_mode',
    groupKey: messagesGroup
  },
  {
    anchorId: 'use-serif-font',
    titleKey: 'settings.messages.use_serif_font',
    groupKey: messagesGroup
  },
  {
    anchorId: 'thought-auto-collapse',
    titleKey: 'chat.settings.thought_auto_collapse.label',
    groupKey: messagesGroup
  },
  {
    anchorId: 'show-message-outline',
    titleKey: 'settings.messages.show_message_outline',
    groupKey: messagesGroup
  },
  {
    anchorId: 'message-style',
    titleKey: 'message.message.style.label',
    groupKey: messagesGroup
  },
  {
    anchorId: 'multi-model-style',
    titleKey: 'message.message.multi_model_style.label',
    groupKey: messagesGroup
  },
  {
    anchorId: 'message-navigation',
    titleKey: 'settings.messages.navigation.label',
    groupKey: messagesGroup
  },
  {
    anchorId: 'message-font-size',
    titleKey: 'settings.font_size.title',
    groupKey: messagesGroup
  },
  {
    anchorId: 'math-single-dollar',
    titleKey: 'settings.math.single_dollar.label',
    groupKey: 'settings.math.title'
  },
  {
    anchorId: 'code-style',
    titleKey: 'message.message.code_style',
    groupKey: 'chat.settings.code.title'
  },
  {
    anchorId: 'code-fancy-block',
    titleKey: 'chat.settings.code_fancy_block.label',
    groupKey: 'chat.settings.code.title'
  },
  {
    anchorId: 'code-editor-enabled',
    titleKey: 'chat.settings.code_editor.title',
    groupKey: 'chat.settings.code.title'
  },
  {
    anchorId: 'show-line-numbers',
    titleKey: 'chat.settings.show_line_numbers',
    groupKey: 'chat.settings.code.title'
  },
  {
    anchorId: 'code-collapsible',
    titleKey: 'chat.settings.code_collapsible',
    groupKey: 'chat.settings.code.title'
  },
  {
    anchorId: 'code-wrappable',
    titleKey: 'chat.settings.code_wrappable',
    groupKey: 'chat.settings.code.title'
  }
]
