/**
 * Auto-generated preference mappings from classification.json
 * Generated at: 2025-09-02T06:27:50.213Z
 *
 * This file contains pure mapping relationships without default values.
 * Default values are managed in packages/shared/data/preferences.ts
 *
 * === AUTO-GENERATED CONTENT START ===
 */

/**
 * ElectronStore映射关系 - 简单一层结构
 *
 * ElectronStore没有嵌套，originalKey直接对应configManager.get(key)
 */
export const ELECTRON_STORE_MAPPINGS = [
  {
    originalKey: 'ZoomFactor',
    targetKey: 'app.zoom_factor'
  }
] as const

/**
 * Redux Store映射关系 - 按category分组，支持嵌套路径
 *
 * Redux Store可能有children结构，originalKey可能包含嵌套路径:
 * - 直接字段: "theme" -> reduxData.settings.theme
 * - 嵌套字段: "codeEditor.enabled" -> reduxData.settings.codeEditor.enabled
 * - 多层嵌套: "exportMenuOptions.docx" -> reduxData.settings.exportMenuOptions.docx
 */
export const REDUX_STORE_MAPPINGS = {
  settings: [
    {
      originalKey: 'autoCheckUpdate',
      targetKey: 'app.dist.auto_update.enabled'
    },
    {
      originalKey: 'clickTrayToShowQuickAssistant',
      targetKey: 'feature.quick_assistant.click_tray_to_show'
    },
    {
      originalKey: 'disableHardwareAcceleration',
      targetKey: 'app.disable_hardware_acceleration'
    },
    {
      originalKey: 'enableDataCollection',
      targetKey: 'app.privacy.data_collection.enabled'
    },
    {
      originalKey: 'enableDeveloperMode',
      targetKey: 'app.developer_mode.enabled'
    },
    {
      originalKey: 'enableQuickAssistant',
      targetKey: 'feature.quick_assistant.enabled'
    },
    {
      originalKey: 'language',
      targetKey: 'app.language'
    },
    {
      originalKey: 'launchToTray',
      targetKey: 'app.tray.on_launch'
    },
    {
      originalKey: 'testChannel',
      targetKey: 'app.dist.test_plan.channel'
    },
    {
      originalKey: 'testPlan',
      targetKey: 'app.dist.test_plan.enabled'
    },
    {
      originalKey: 'theme',
      targetKey: 'ui.theme_mode'
    },
    {
      originalKey: 'tray',
      targetKey: 'app.tray.enabled'
    },
    {
      originalKey: 'trayOnClose',
      targetKey: 'app.tray.on_close'
    },
    {
      originalKey: 'showAssistants',
      targetKey: 'assistant.tab.show'
    },
    {
      originalKey: 'showTopics',
      targetKey: 'topic.tab.show'
    },
    {
      originalKey: 'assistantsTabSortType',
      targetKey: 'assistant.tab.sort_type'
    },
    {
      originalKey: 'sendMessageShortcut',
      targetKey: 'chat.input.send_message_shortcut'
    },
    {
      originalKey: 'targetLanguage',
      targetKey: 'feature.translate.target_language'
    },
    {
      originalKey: 'proxyMode',
      targetKey: 'app.proxy.mode'
    },
    {
      originalKey: 'proxyUrl',
      targetKey: 'app.proxy.url'
    },
    {
      originalKey: 'proxyBypassRules',
      targetKey: 'app.proxy.bypass_rules'
    },
    {
      originalKey: 'userName',
      targetKey: 'app.user.name'
    },
    {
      originalKey: 'userId',
      targetKey: 'app.user.id'
    },
    {
      originalKey: 'showPrompt',
      targetKey: 'chat.message.show_prompt'
    },
    {
      originalKey: 'showMessageDivider',
      targetKey: 'chat.message.show_divider'
    },
    {
      originalKey: 'messageFont',
      targetKey: 'chat.message.font'
    },
    {
      originalKey: 'showInputEstimatedTokens',
      targetKey: 'chat.input.show_estimated_tokens'
    },
    {
      originalKey: 'launchOnBoot',
      targetKey: 'app.launch_on_boot'
    },
    {
      originalKey: 'userTheme.colorPrimary',
      targetKey: 'ui.theme_user.color_primary'
    },
    {
      originalKey: 'windowStyle',
      targetKey: 'ui.window_style'
    },
    {
      originalKey: 'fontSize',
      targetKey: 'chat.message.font_size'
    },
    {
      originalKey: 'topicPosition',
      targetKey: 'topic.position'
    },
    {
      originalKey: 'showTopicTime',
      targetKey: 'topic.tab.show_time'
    },
    {
      originalKey: 'pinTopicsToTop',
      targetKey: 'topic.tab.pin_to_top'
    },
    {
      originalKey: 'assistantIconType',
      targetKey: 'assistant.icon_type'
    },
    {
      originalKey: 'pasteLongTextAsFile',
      targetKey: 'chat.input.paste_long_text_as_file'
    },
    {
      originalKey: 'pasteLongTextThreshold',
      targetKey: 'chat.input.paste_long_text_threshold'
    },
    {
      originalKey: 'clickAssistantToShowTopic',
      targetKey: 'assistant.click_to_show_topic'
    },
    {
      originalKey: 'codeExecution.enabled',
      targetKey: 'chat.code.execution.enabled'
    },
    {
      originalKey: 'codeExecution.timeoutMinutes',
      targetKey: 'chat.code.execution.timeout_minutes'
    },
    {
      originalKey: 'codeEditor.enabled',
      targetKey: 'chat.code.editor.enabled'
    },
    {
      originalKey: 'codeEditor.themeLight',
      targetKey: 'chat.code.editor.theme_light'
    },
    {
      originalKey: 'codeEditor.themeDark',
      targetKey: 'chat.code.editor.theme_dark'
    },
    {
      originalKey: 'codeEditor.highlightActiveLine',
      targetKey: 'chat.code.editor.highlight_active_line'
    },
    {
      originalKey: 'codeEditor.foldGutter',
      targetKey: 'chat.code.editor.fold_gutter'
    },
    {
      originalKey: 'codeEditor.autocompletion',
      targetKey: 'chat.code.editor.autocompletion'
    },
    {
      originalKey: 'codeEditor.keymap',
      targetKey: 'chat.code.editor.keymap'
    },
    {
      originalKey: 'codePreview.themeLight',
      targetKey: 'chat.code.preview.theme_light'
    },
    {
      originalKey: 'codePreview.themeDark',
      targetKey: 'chat.code.preview.theme_dark'
    },
    {
      originalKey: 'codeViewer.themeLight',
      targetKey: 'chat.code.viewer.theme_light'
    },
    {
      originalKey: 'codeViewer.themeDark',
      targetKey: 'chat.code.viewer.theme_dark'
    },
    {
      originalKey: 'codeShowLineNumbers',
      targetKey: 'chat.code.show_line_numbers'
    },
    {
      originalKey: 'codeCollapsible',
      targetKey: 'chat.code.collapsible'
    },
    {
      originalKey: 'codeWrappable',
      targetKey: 'chat.code.wrappable'
    },
    {
      originalKey: 'codeImageTools',
      targetKey: 'chat.code.image_tools'
    },
    {
      originalKey: 'mathEngine',
      targetKey: 'chat.message.math_engine'
    },
    {
      originalKey: 'messageStyle',
      targetKey: 'chat.message.style'
    },
    {
      originalKey: 'foldDisplayMode',
      targetKey: 'chat.message.multi_model.fold_display_mode'
    },
    {
      originalKey: 'gridColumns',
      targetKey: 'chat.message.multi_model.grid_columns'
    },
    {
      originalKey: 'gridPopoverTrigger',
      targetKey: 'chat.message.multi_model.grid_popover_trigger'
    },
    {
      originalKey: 'messageNavigation',
      targetKey: 'chat.message.navigation_mode'
    },
    {
      originalKey: 'skipBackupFile',
      targetKey: 'data.backup.general.skip_backup_file'
    },
    {
      originalKey: 'webdavHost',
      targetKey: 'data.backup.webdav.host'
    },
    {
      originalKey: 'webdavUser',
      targetKey: 'data.backup.webdav.user'
    },
    {
      originalKey: 'webdavPass',
      targetKey: 'data.backup.webdav.pass'
    },
    {
      originalKey: 'webdavPath',
      targetKey: 'data.backup.webdav.path'
    },
    {
      originalKey: 'webdavAutoSync',
      targetKey: 'data.backup.webdav.auto_sync'
    },
    {
      originalKey: 'webdavSyncInterval',
      targetKey: 'data.backup.webdav.sync_interval'
    },
    {
      originalKey: 'webdavMaxBackups',
      targetKey: 'data.backup.webdav.max_backups'
    },
    {
      originalKey: 'webdavSkipBackupFile',
      targetKey: 'data.backup.webdav.skip_backup_file'
    },
    {
      originalKey: 'webdavDisableStream',
      targetKey: 'data.backup.webdav.disable_stream'
    },
    {
      originalKey: 'translateModelPrompt',
      targetKey: 'feature.translate.model_prompt'
    },
    {
      originalKey: 'autoTranslateWithSpace',
      targetKey: 'chat.input.translate.auto_translate_with_space'
    },
    {
      originalKey: 'showTranslateConfirm',
      targetKey: 'chat.input.translate.show_confirm'
    },
    {
      originalKey: 'enableTopicNaming',
      targetKey: 'topic.naming.enabled'
    },
    {
      originalKey: 'customCss',
      targetKey: 'ui.custom_css'
    },
    {
      originalKey: 'topicNamingPrompt',
      targetKey: 'topic.naming.prompt'
    },
    {
      originalKey: 'narrowMode',
      targetKey: 'chat.narrow_mode'
    },
    {
      originalKey: 'multiModelMessageStyle',
      targetKey: 'chat.message.multi_model.style'
    },
    {
      originalKey: 'readClipboardAtStartup',
      targetKey: 'feature.quick_assistant.read_clipboard_at_startup'
    },
    {
      originalKey: 'notionDatabaseID',
      targetKey: 'data.integration.notion.database_id'
    },
    {
      originalKey: 'notionApiKey',
      targetKey: 'data.integration.notion.api_key'
    },
    {
      originalKey: 'notionPageNameKey',
      targetKey: 'data.integration.notion.page_name_key'
    },
    {
      originalKey: 'markdownExportPath',
      targetKey: 'data.export.markdown.path'
    },
    {
      originalKey: 'forceDollarMathInMarkdown',
      targetKey: 'data.export.markdown.force_dollar_math'
    },
    {
      originalKey: 'useTopicNamingForMessageTitle',
      targetKey: 'data.export.markdown.use_topic_naming_for_message_title'
    },
    {
      originalKey: 'showModelNameInMarkdown',
      targetKey: 'data.export.markdown.show_model_name'
    },
    {
      originalKey: 'showModelProviderInMarkdown',
      targetKey: 'data.export.markdown.show_model_provider'
    },
    {
      originalKey: 'thoughtAutoCollapse',
      targetKey: 'chat.message.thought.auto_collapse'
    },
    {
      originalKey: 'notionExportReasoning',
      targetKey: 'data.integration.notion.export_reasoning'
    },
    {
      originalKey: 'excludeCitationsInExport',
      targetKey: 'data.export.markdown.exclude_citations'
    },
    {
      originalKey: 'standardizeCitationsInExport',
      targetKey: 'data.export.markdown.standardize_citations'
    },
    {
      originalKey: 'yuqueToken',
      targetKey: 'data.integration.yuque.token'
    },
    {
      originalKey: 'yuqueUrl',
      targetKey: 'data.integration.yuque.url'
    },
    {
      originalKey: 'yuqueRepoId',
      targetKey: 'data.integration.yuque.repo_id'
    },
    {
      originalKey: 'joplinToken',
      targetKey: 'data.integration.joplin.token'
    },
    {
      originalKey: 'joplinUrl',
      targetKey: 'data.integration.joplin.url'
    },
    {
      originalKey: 'joplinExportReasoning',
      targetKey: 'data.integration.joplin.export_reasoning'
    },
    {
      originalKey: 'defaultObsidianVault',
      targetKey: 'data.integration.obsidian.default_vault'
    },
    {
      originalKey: 'siyuanApiUrl',
      targetKey: 'data.integration.siyuan.api_url'
    },
    {
      originalKey: 'siyuanToken',
      targetKey: 'data.integration.siyuan.token'
    },
    {
      originalKey: 'siyuanBoxId',
      targetKey: 'data.integration.siyuan.box_id'
    },
    {
      originalKey: 'siyuanRootPath',
      targetKey: 'data.integration.siyuan.root_path'
    },
    {
      originalKey: 'maxKeepAliveMinapps',
      targetKey: 'feature.minapp.max_keep_alive'
    },
    {
      originalKey: 'showOpenedMinappsInSidebar',
      targetKey: 'feature.minapp.show_opened_in_sidebar'
    },
    {
      originalKey: 'minappsOpenLinkExternal',
      targetKey: 'feature.minapp.open_link_external'
    },
    {
      originalKey: 'enableSpellCheck',
      targetKey: 'app.spell_check.enabled'
    },
    {
      originalKey: 'spellCheckLanguages',
      targetKey: 'app.spell_check.languages'
    },
    {
      originalKey: 'enableQuickPanelTriggers',
      targetKey: 'chat.input.quick_panel.triggers_enabled'
    },
    {
      originalKey: 'exportMenuOptions.image',
      targetKey: 'data.export.menus.image'
    },
    {
      originalKey: 'exportMenuOptions.markdown',
      targetKey: 'data.export.menus.markdown'
    },
    {
      originalKey: 'exportMenuOptions.markdown_reason',
      targetKey: 'data.export.menus.markdown_reason'
    },
    {
      originalKey: 'exportMenuOptions.notion',
      targetKey: 'data.export.menus.notion'
    },
    {
      originalKey: 'exportMenuOptions.yuque',
      targetKey: 'data.export.menus.yuque'
    },
    {
      originalKey: 'exportMenuOptions.joplin',
      targetKey: 'data.export.menus.joplin'
    },
    {
      originalKey: 'exportMenuOptions.obsidian',
      targetKey: 'data.export.menus.obsidian'
    },
    {
      originalKey: 'exportMenuOptions.siyuan',
      targetKey: 'data.export.menus.siyuan'
    },
    {
      originalKey: 'exportMenuOptions.docx',
      targetKey: 'data.export.menus.docx'
    },
    {
      originalKey: 'exportMenuOptions.plain_text',
      targetKey: 'data.export.menus.plain_text'
    },
    {
      originalKey: 'notification.assistant',
      targetKey: 'app.notification.assistant.enabled'
    },
    {
      originalKey: 'notification.backup',
      targetKey: 'app.notification.backup.enabled'
    },
    {
      originalKey: 'notification.knowledge',
      targetKey: 'app.notification.knowledge.enabled'
    },
    {
      originalKey: 'localBackupDir',
      targetKey: 'data.backup.local.dir'
    },
    {
      originalKey: 'localBackupAutoSync',
      targetKey: 'data.backup.local.auto_sync'
    },
    {
      originalKey: 'localBackupSyncInterval',
      targetKey: 'data.backup.local.sync_interval'
    },
    {
      originalKey: 'localBackupMaxBackups',
      targetKey: 'data.backup.local.max_backups'
    },
    {
      originalKey: 'localBackupSkipBackupFile',
      targetKey: 'data.backup.local.skip_backup_file'
    },
    {
      originalKey: 's3.endpoint',
      targetKey: 'data.backup.s3.endpoint'
    },
    {
      originalKey: 's3.region',
      targetKey: 'data.backup.s3.region'
    },
    {
      originalKey: 's3.bucket',
      targetKey: 'data.backup.s3.bucket'
    },
    {
      originalKey: 's3.accessKeyId',
      targetKey: 'data.backup.s3.access_key_id'
    },
    {
      originalKey: 's3.secretAccessKey',
      targetKey: 'data.backup.s3.secret_access_key'
    },
    {
      originalKey: 's3.root',
      targetKey: 'data.backup.s3.root'
    },
    {
      originalKey: 's3.autoSync',
      targetKey: 'data.backup.s3.auto_sync'
    },
    {
      originalKey: 's3.syncInterval',
      targetKey: 'data.backup.s3.sync_interval'
    },
    {
      originalKey: 's3.maxBackups',
      targetKey: 'data.backup.s3.max_backups'
    },
    {
      originalKey: 's3.skipBackupFile',
      targetKey: 'data.backup.s3.skip_backup_file'
    },
    {
      originalKey: 'navbarPosition',
      targetKey: 'ui.navbar.position'
    },
    {
      originalKey: 'apiServer.enabled',
      targetKey: 'feature.csaas.enabled'
    },
    {
      originalKey: 'apiServer.host',
      targetKey: 'feature.csaas.host'
    },
    {
      originalKey: 'apiServer.port',
      targetKey: 'feature.csaas.port'
    },
    {
      originalKey: 'apiServer.apiKey',
      targetKey: 'feature.csaas.api_key'
    }
  ],
  selectionStore: [
    {
      originalKey: 'selectionEnabled',
      targetKey: 'feature.selection.enabled'
    },
    {
      originalKey: 'filterList',
      targetKey: 'feature.selection.filter_list'
    },
    {
      originalKey: 'filterMode',
      targetKey: 'feature.selection.filter_mode'
    },
    {
      originalKey: 'isFollowToolbar',
      targetKey: 'feature.selection.follow_toolbar'
    },
    {
      originalKey: 'isRemeberWinSize',
      targetKey: 'feature.selection.remember_win_size'
    },
    {
      originalKey: 'triggerMode',
      targetKey: 'feature.selection.trigger_mode'
    },
    {
      originalKey: 'isCompact',
      targetKey: 'feature.selection.compact'
    },
    {
      originalKey: 'isAutoClose',
      targetKey: 'feature.selection.auto_close'
    },
    {
      originalKey: 'isAutoPin',
      targetKey: 'feature.selection.auto_pin'
    },
    {
      originalKey: 'actionWindowOpacity',
      targetKey: 'feature.selection.action_window_opacity'
    },
    {
      originalKey: 'actionItems',
      targetKey: 'feature.selection.action_items'
    }
  ],
  nutstore: [
    {
      originalKey: 'nutstoreToken',
      targetKey: 'data.backup.nutstore.token'
    },
    {
      originalKey: 'nutstorePath',
      targetKey: 'data.backup.nutstore.path'
    },
    {
      originalKey: 'nutstoreAutoSync',
      targetKey: 'data.backup.nutstore.auto_sync'
    },
    {
      originalKey: 'nutstoreSyncInterval',
      targetKey: 'data.backup.nutstore.sync_interval'
    },
    {
      originalKey: 'nutstoreSyncState',
      targetKey: 'data.backup.nutstore.sync_state'
    },
    {
      originalKey: 'nutstoreSkipBackupFile',
      targetKey: 'data.backup.nutstore.skip_backup_file'
    }
  ],
  shortcuts: [
    {
      originalKey: 'shortcuts.zoom_in',
      targetKey: 'shortcut.app.zoom_in'
    },
    {
      originalKey: 'shortcuts.zoom_out',
      targetKey: 'shortcut.app.zoom_out'
    },
    {
      originalKey: 'shortcuts.zoom_reset',
      targetKey: 'shortcut.app.zoom_reset'
    },
    {
      originalKey: 'shortcuts.show_settings',
      targetKey: 'shortcut.app.show_settings'
    },
    {
      originalKey: 'shortcuts.show_app',
      targetKey: 'shortcut.app.show_main_window'
    },
    {
      originalKey: 'shortcuts.mini_window',
      targetKey: 'shortcut.app.show_mini_window'
    },
    {
      originalKey: 'shortcuts.selection_assistant_toggle',
      targetKey: 'shortcut.selection.toggle_enabled'
    },
    {
      originalKey: 'shortcuts.selection_assistant_select_text',
      targetKey: 'shortcut.selection.get_text'
    },
    {
      originalKey: 'shortcuts.new_topic',
      targetKey: 'shortcut.topic.new'
    },
    {
      originalKey: 'shortcuts.toggle_show_assistants',
      targetKey: 'shortcut.app.toggle_show_assistants'
    },
    {
      originalKey: 'shortcuts.copy_last_message',
      targetKey: 'shortcut.chat.copy_last_message'
    },
    {
      originalKey: 'shortcuts.search_message_in_chat',
      targetKey: 'shortcut.chat.search_message'
    },
    {
      originalKey: 'shortcuts.search_message',
      targetKey: 'shortcut.app.search_message'
    },
    {
      originalKey: 'shortcuts.clear_topic',
      targetKey: 'shortcut.chat.clear'
    },
    {
      originalKey: 'shortcuts.toggle_new_context',
      targetKey: 'shortcut.chat.toggle_new_context'
    },
    {
      originalKey: 'shortcuts.exit_fullscreen',
      targetKey: 'shortcut.app.exit_fullscreen'
    }
  ]
} as const

// === AUTO-GENERATED CONTENT END ===

/**
 * 映射统计:
 * - ElectronStore项: 1
 * - Redux Store项: 175
 * - Redux分类: settings, selectionStore, nutstore, shortcuts
 * - 总配置项: 176
 *
 * 使用说明:
 * 1. ElectronStore读取: configManager.get(mapping.originalKey)
 * 2. Redux读取: 需要解析嵌套路径 reduxData[category][originalKey路径]
 * 3. 默认值: 从defaultPreferences.default[mapping.targetKey]获取
 */
