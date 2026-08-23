import type { SettingsSearchEntry } from '../settingsSearch/types'

// Data settings switches its 13 panels via component state, not sub-routes, so
// each entry carries the owning panel key — jumps navigate as /settings/data?panel=<key>
// and DataSettings mounts that panel before the anchor lookup. Conditional rows
// (v1 remigration) and modal-only actions stay out per D8.
export const route = '/settings/data'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'data-backup-restore',
    titleKey: 'settings.general.backup.title',
    panel: 'data',
    groupKey: 'settings.data.title'
  },
  {
    anchorId: 'data-skip-file-data',
    titleKey: 'settings.data.backup.skip_file_data_title',
    panel: 'data',
    groupKey: 'settings.data.title'
  },
  {
    anchorId: 'data-app-data',
    titleKey: 'settings.data.app_data.label',
    panel: 'data',
    groupKey: 'settings.data.data.title',
    aliases: ['data directory', '数据目录']
  },
  {
    anchorId: 'data-app-logs',
    titleKey: 'settings.data.app_logs.label',
    panel: 'data',
    groupKey: 'settings.data.data.title',
    aliases: ['logs', '日志']
  },
  {
    anchorId: 'data-clear-cache',
    titleKey: 'settings.data.clear_cache.title',
    panel: 'data',
    groupKey: 'settings.data.data.title',
    aliases: ['cache', '缓存']
  },
  {
    anchorId: 'data-reset',
    titleKey: 'settings.data.data_reset.title',
    panel: 'data',
    groupKey: 'settings.data.data.title'
  },
  {
    anchorId: 'data-privacy-mode',
    titleKey: 'settings.privacy.enable_privacy_mode',
    panel: 'data',
    groupKey: 'settings.privacy.title'
  },
  {
    anchorId: 'local-backup-directory',
    titleKey: 'settings.data.local.directory.label',
    panel: 'local_backup',
    groupKey: 'settings.data.local.title'
  },
  {
    anchorId: 'webdav-host',
    titleKey: 'settings.data.webdav.host.label',
    panel: 'webdav',
    groupKey: 'settings.data.webdav.title',
    aliases: ['webdav']
  },
  {
    anchorId: 'webdav-user',
    titleKey: 'settings.data.webdav.user',
    panel: 'webdav',
    groupKey: 'settings.data.webdav.title'
  },
  {
    anchorId: 'webdav-password',
    titleKey: 'settings.data.webdav.password',
    panel: 'webdav',
    groupKey: 'settings.data.webdav.title'
  },
  {
    anchorId: 'webdav-path',
    titleKey: 'settings.data.webdav.path.label',
    panel: 'webdav',
    groupKey: 'settings.data.webdav.title'
  },
  {
    anchorId: 's3-endpoint',
    titleKey: 'settings.data.s3.endpoint.label',
    panel: 's3',
    groupKey: 'settings.data.s3.title.label',
    aliases: ['s3']
  },
  {
    anchorId: 's3-bucket',
    titleKey: 'settings.data.s3.bucket.label',
    panel: 's3',
    groupKey: 'settings.data.s3.title.label'
  },
  {
    anchorId: 's3-region',
    titleKey: 'settings.data.s3.region.label',
    panel: 's3',
    groupKey: 'settings.data.s3.title.label'
  },
  {
    anchorId: 's3-access-key',
    titleKey: 'settings.data.s3.accessKeyId.label',
    panel: 's3',
    groupKey: 'settings.data.s3.title.label'
  },
  {
    anchorId: 's3-auto-sync',
    titleKey: 'settings.data.s3.autoSync.label',
    panel: 's3',
    groupKey: 'settings.data.s3.title.label'
  },
  {
    anchorId: 's3-max-backups',
    titleKey: 'settings.data.s3.maxBackups.label',
    panel: 's3',
    groupKey: 'settings.data.s3.title.label'
  },
  {
    anchorId: 'import-chatgpt',
    titleKey: 'settings.data.import_settings.chatgpt',
    panel: 'import_settings',
    groupKey: 'settings.data.import_settings.title'
  },
  {
    anchorId: 'import-claude',
    titleKey: 'settings.data.import_settings.claude',
    panel: 'import_settings',
    groupKey: 'settings.data.import_settings.title'
  },
  {
    anchorId: 'export-image',
    titleKey: 'settings.data.export_menu.image',
    panel: 'export_menu',
    groupKey: 'settings.data.export_menu.title'
  },
  {
    anchorId: 'export-markdown',
    titleKey: 'settings.data.export_menu.markdown',
    panel: 'export_menu',
    groupKey: 'settings.data.export_menu.title'
  },
  {
    anchorId: 'export-docx',
    titleKey: 'settings.data.export_menu.docx',
    panel: 'export_menu',
    groupKey: 'settings.data.export_menu.title'
  },
  {
    anchorId: 'export-plain-text',
    titleKey: 'settings.data.export_menu.plain_text',
    panel: 'export_menu',
    groupKey: 'settings.data.export_menu.title'
  },
  {
    anchorId: 'markdown-export-path',
    titleKey: 'settings.data.markdown_export.path',
    panel: 'markdown_export',
    groupKey: 'settings.data.markdown_export.title'
  },
  {
    anchorId: 'markdown-export-model-name',
    titleKey: 'settings.data.markdown_export.show_model_name.title',
    panel: 'markdown_export',
    groupKey: 'settings.data.markdown_export.title'
  },
  {
    anchorId: 'markdown-export-model-provider',
    titleKey: 'settings.data.markdown_export.show_model_provider.title',
    panel: 'markdown_export',
    groupKey: 'settings.data.markdown_export.title'
  },
  {
    anchorId: 'markdown-export-citations',
    titleKey: 'settings.data.markdown_export.standardize_citations.title',
    panel: 'markdown_export',
    groupKey: 'settings.data.markdown_export.title'
  },
  {
    anchorId: 'markdown-export-topic-naming',
    titleKey: 'settings.data.message_title.use_topic_naming.title',
    panel: 'markdown_export',
    groupKey: 'settings.data.markdown_export.title'
  },
  {
    anchorId: 'notion-api-key',
    titleKey: 'settings.data.notion.api_key',
    panel: 'notion',
    groupKey: 'settings.data.notion.title',
    aliases: ['notion']
  },
  {
    anchorId: 'notion-database-id',
    titleKey: 'settings.data.notion.database_id',
    panel: 'notion',
    groupKey: 'settings.data.notion.title'
  },
  {
    anchorId: 'yuque-token',
    titleKey: 'settings.data.yuque.token',
    panel: 'yuque',
    groupKey: 'settings.data.yuque.title',
    aliases: ['yuque', '语雀']
  },
  {
    anchorId: 'yuque-repo-url',
    titleKey: 'settings.data.yuque.repo_url',
    panel: 'yuque',
    groupKey: 'settings.data.yuque.title'
  },
  {
    anchorId: 'joplin-url',
    titleKey: 'settings.data.joplin.url',
    panel: 'joplin',
    groupKey: 'settings.data.joplin.title',
    aliases: ['joplin']
  },
  {
    anchorId: 'joplin-token',
    titleKey: 'settings.data.joplin.token',
    panel: 'joplin',
    groupKey: 'settings.data.joplin.title'
  },
  {
    anchorId: 'obsidian-default-vault',
    titleKey: 'settings.data.obsidian.default_vault',
    panel: 'obsidian',
    groupKey: 'settings.data.obsidian.title',
    aliases: ['obsidian']
  },
  {
    anchorId: 'siyuan-api-url',
    titleKey: 'settings.data.siyuan.api_url',
    panel: 'siyuan',
    groupKey: 'settings.data.siyuan.title',
    aliases: ['siyuan', '思源笔记']
  },
  {
    anchorId: 'siyuan-token',
    titleKey: 'settings.data.siyuan.token.label',
    panel: 'siyuan',
    groupKey: 'settings.data.siyuan.title'
  }
]
