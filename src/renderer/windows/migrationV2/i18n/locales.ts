/**
 * Migration window translations
 * Supports Chinese (zh-CN) and English (en-US)
 */

export const zhCN = {
  settings: {
    theme: {
      dark: '深色模式',
      light: '浅色模式',
      system: '跟随系统'
    }
  },
  migration: {
    title: '数据迁移向导',
    stages: {
      introduction: '介绍',
      backup: '备份',
      migration: '迁移',
      completed: '完成'
    },
    buttons: {
      back: '返回',
      next: '下一步',
      create_backup: '创建新备份',
      already_backed_up: '已有备份',
      confirm_and_continue: '确认并继续',
      start_migration: '开始迁移',
      restart: '重启应用',
      retry: '重试',
      close: '关闭应用',
      ignore_migration: '忽略并使用默认值',
      skip_migration: '跳过迁移',
      more_options: '更多选项'
    },
    window: {
      minimize: '最小化',
      close: '关闭',
      confirm_close: {
        title: '退出数据迁移',
        message: '迁移流程尚未完成，关闭窗口将退出应用，下次启动需要重新开始。确定要退出吗？',
        continue: '继续迁移',
        quit: '退出',
        quit_pending: '当前步骤完成后将自动退出应用，请稍候…'
      }
    },
    language: {
      select: '切换语言'
    },
    status: {
      pending: '等待中',
      running: '进行中',
      completed: '完成',
      failed: '失败'
    },
    introduction: {
      title: '将数据迁移到新的架构中',
      subtitle: 'Cherry Studio V2 · 全新数据架构',
      features: {
        architecture: {
          title: '全新数据架构',
          description: '存储与使用方式重构，效率与安全性大幅提升。'
        },
        migration: {
          title: '需要迁移数据',
          description: '旧版数据需要迁移后，才能在 V2 中继续使用。'
        },
        safety: {
          title: '安全且可重试',
          description: '旧版数据会保留在磁盘中，迁移失败后可重新尝试。'
        }
      }
    },
    skip_dialog: {
      title: '跳过数据迁移',
      warning_prefix: '高危操作：',
      warning_body: '将以默认配置启动，并不再自动提示迁移。',
      points: {
        retained_strong: '旧数据会保留在磁盘中',
        retained_rest: '，但不会导入 V2。',
        not_visible: '旧版对话、设置、知识库等内容不会出现在新版本中。',
        skip_before: '仅当你确定要',
        skip_strong: '放弃本次自动迁移',
        skip_after: '时继续。'
      },
      cancel: '取消',
      confirm: '已知晓风险，跳过并重启',
      confirm_countdown: '已知晓风险，跳过并重启 ({{seconds}}s)'
    },
    backup_required: {
      title: '创建数据备份',
      description: '迁移前必须创建数据备份以确保数据安全。请选择备份位置或确认已有最新备份。',
      recommended: '推荐',
      create_desc: '为旧版数据创建一份完整备份，再开始迁移。',
      existing_desc: '我已在别处备份过旧版数据，直接继续迁移。',
      failure: '备份失败：{{reason}}'
    },
    backup_progress: {
      title: '正在备份 V1 数据…',
      description: '正在创建旧版数据的完整备份，请勿关闭应用…',
      compressing: '压缩中，请勿关闭应用…',
      compressing_long: '备份文件较大，压缩仍在继续，请保持应用打开…'
    },
    backup_confirmed: {
      created_title: '备份成功',
      created_description: '数据备份已完成，现在可以安全地开始迁移。',
      existing_title: '已有备份',
      existing_description: '你已确认已有可用的 V1 数据备份，可以开始迁移。'
    },
    migration: {
      title: '正在迁移数据...',
      do_not_close: '迁移进行中，请勿关闭应用…'
    },
    progress: {
      processing: '正在处理{{name}}...',
      migrated_boot_config: '已迁移 {{processed}}/{{total}} 条启动配置',
      migrated_chats: '已迁移 {{processed}}/{{total}} 个对话，{{messages}} 条消息',
      migrated_preferences: '已迁移 {{processed}}/{{total}} 条配置',
      migrated_knowledge: '已迁移 {{processed}}/{{total}} 条知识库记录',
      migrated_knowledge_vectors: '已迁移 {{processed}}/{{total}} 个知识库向量工作单元',
      migrated_assistants: '已迁移 {{processed}}/{{total}} 个助手',
      migrated_files: '已迁移 {{processed}}/{{total}} 个文件',
      migrated_mcp_servers: '已迁移 {{processed}}/{{total}} 个 MCP 服务器',
      migrated_miniapps: '已迁移 {{processed}}/{{total}} 个小程序',
      migrated_translate_languages: '已迁移 {{processed}}/{{total}} 种翻译语言',
      migrated_translate_history: '已迁移 {{processed}}/{{total}} 条翻译记录',
      prepared_chats: '已准备 {{processed}}/{{total}} 个对话'
    },
    completed: {
      title: '欢迎来到 Cherry Studio V2',
      description: '迁移完成，你的数据已经全部就位。重启应用即可开始使用 V2。',
      steps_label: '步骤已完成',
      items_label: '迁移项',
      duration_label: '迁移耗时',
      backup_heading: 'V1 备份',
      warning_heading: '{{count}} 条迁移提示',
      warning_description: '数据已迁移完成，但以下内容需要注意。'
    },
    error: {
      title: '迁移失败',
      description: '迁移过程遇到错误，您可以重新尝试或继续使用之前版本（原始数据完好保存）。',
      error_prefix: '错误信息：',
      unknown: '未知错误'
    },
    version_incompatible: {
      title: '版本升级提示',
      preamble: 'Cherry Studio 对数据存储进行了重大重构，为了保证旧数据的安全迁移，我们对升级顺序有严格要求。',
      no_version_log:
        '无法确定您之前使用的版本。请先安装 {{requiredVersion}} 版本并运行一次，然后再安装此版本进行数据迁移。',
      v1_too_old:
        '您之前的版本（{{previousVersion}}）过旧，无法直接迁移。请先升级到 {{requiredVersion}} 版本并运行一次，然后再安装此版本。',
      v2_gateway_skipped:
        '无法从 {{previousVersion}} 直接升级到 {{currentVersion}}。请先安装 {{gatewayVersion}} 版本完成数据迁移，然后再升级到此版本。',
      ignore_hint: '您也可以选择忽略旧数据，直接以全新默认配置启动。'
    }
  }
}

export const enUS = {
  settings: {
    theme: {
      dark: 'Dark mode',
      light: 'Light mode',
      system: 'System'
    }
  },
  migration: {
    title: 'Data Migration Wizard',
    stages: {
      introduction: 'Introduction',
      backup: 'Backup',
      migration: 'Migration',
      completed: 'Completed'
    },
    buttons: {
      back: 'Back',
      next: 'Next',
      create_backup: 'Create new backup',
      already_backed_up: 'Already backed up',
      confirm_and_continue: 'Confirm and continue',
      start_migration: 'Start Migration',
      restart: 'Restart App',
      retry: 'Retry',
      close: 'Close App',
      ignore_migration: 'Ignore and Use Defaults',
      skip_migration: 'Skip migration',
      more_options: 'More options'
    },
    window: {
      minimize: 'Minimize',
      close: 'Close',
      confirm_close: {
        title: 'Exit data migration',
        message:
          "Migration isn't finished yet. Closing the window will quit the app and you'll need to start over next launch. Quit anyway?",
        continue: 'Continue migration',
        quit: 'Quit',
        quit_pending: 'The app will close automatically once the current step finishes…'
      }
    },
    language: {
      select: 'Switch language'
    },
    status: {
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed'
    },
    introduction: {
      title: 'Migrate Data to New Architecture',
      subtitle: 'Cherry Studio V2 · New Data Architecture',
      features: {
        architecture: {
          title: 'New Data Architecture',
          description: 'Storage and usage are rebuilt for major gains in efficiency and security.'
        },
        migration: {
          title: 'Migration Required',
          description: 'Legacy data must be migrated before it can be used in V2.'
        },
        safety: {
          title: 'Safe and Retryable',
          description: 'Your legacy data stays on disk, so you can retry if a migration fails.'
        }
      }
    },
    skip_dialog: {
      title: 'Skip Data Migration',
      warning_prefix: 'High-risk action: ',
      warning_body: 'Starts with default settings, and migration will not be prompted again.',
      points: {
        retained_strong: 'Old data will remain on disk',
        retained_rest: ', but it will not be imported into V2.',
        not_visible: 'Legacy chats, settings, knowledge bases, and related content will not appear in the new version.',
        skip_before: 'Continue only if you are sure you want to ',
        skip_strong: 'skip this automatic migration',
        skip_after: '.'
      },
      cancel: 'Cancel',
      confirm: 'I understand the risk, skip and restart',
      confirm_countdown: 'I understand the risk, skip and restart ({{seconds}}s)'
    },
    backup_required: {
      title: 'Create Data Backup',
      description:
        'A data backup must be created before migration to ensure data safety. Please select a backup location or confirm you have a recent backup.',
      recommended: 'Recommended',
      create_desc: 'Create a full backup of your legacy data before migrating.',
      existing_desc: 'I already backed up my legacy data elsewhere; continue to migration.',
      failure: 'Backup failed: {{reason}}'
    },
    backup_progress: {
      title: 'Backing up V1 data…',
      description: 'Creating a full backup of your legacy data — please do not close the app…',
      compressing: 'Compressing, please do not close the app…',
      compressing_long: 'The backup is large, so compression is still running. Please keep the app open…'
    },
    backup_confirmed: {
      created_title: 'Backup successful',
      created_description: 'Data backup has been completed. You can now safely start the migration.',
      existing_title: 'Already backed up',
      existing_description: 'You confirmed that you already have a usable V1 data backup. You can start migration.'
    },
    migration: {
      title: 'Migrating Data...',
      do_not_close: 'Migration in progress, please do not close the app…'
    },
    progress: {
      processing: 'Processing {{name}}...',
      migrated_boot_config: 'Migrated {{processed}}/{{total}} boot config items',
      migrated_chats: 'Migrated {{processed}}/{{total}} conversations, {{messages}} messages',
      migrated_preferences: 'Migrated {{processed}}/{{total}} preferences',
      migrated_knowledge: 'Migrated {{processed}}/{{total}} knowledge records',
      migrated_knowledge_vectors: 'Migrated {{processed}}/{{total}} knowledge vector work units',
      migrated_assistants: 'Migrated {{processed}}/{{total}} assistants',
      migrated_files: 'Migrated {{processed}}/{{total}} files',
      migrated_mcp_servers: 'Migrated {{processed}}/{{total}} MCP servers',
      migrated_miniapps: 'Migrated {{processed}}/{{total}} mini apps',
      migrated_translate_languages: 'Migrated {{processed}}/{{total}} translate languages',
      migrated_translate_history: 'Migrated {{processed}}/{{total}} translate history records',
      prepared_chats: 'Prepared {{processed}}/{{total}} conversations'
    },
    completed: {
      title: 'Welcome to Cherry Studio V2',
      description: 'Migration is complete. Your data is ready. Restart the app to start using V2.',
      steps_label: 'Steps completed',
      items_label: 'Migration items',
      duration_label: 'Migration time',
      backup_heading: 'V1 backup',
      warning_heading: '{{count}} migration notice(s)',
      warning_description: 'Migration completed, but the following items need attention.'
    },
    error: {
      title: 'Migration Failed',
      description:
        'An error occurred during migration. You can retry or continue using the previous version (original data is intact).',
      error_prefix: 'Error: ',
      unknown: 'Unknown error'
    },
    version_incompatible: {
      title: 'Version Upgrade Required',
      preamble:
        'Cherry Studio has undergone a major data storage refactoring. To ensure safe migration of your data, we have strict requirements on the upgrade order.',
      no_version_log:
        'Cannot determine your previous version. Please install version {{requiredVersion}} first and run it at least once, then install this version to complete the data migration.',
      v1_too_old:
        'Your previous version ({{previousVersion}}) is too old to migrate directly. Please install version {{requiredVersion}} first, then install this version.',
      v2_gateway_skipped:
        'Cannot upgrade directly from {{previousVersion}} to {{currentVersion}}. Please install version {{gatewayVersion}} first to complete the data migration, then upgrade to this version.',
      ignore_hint: 'You can also choose to ignore old data and start fresh with default settings.'
    }
  }
}
