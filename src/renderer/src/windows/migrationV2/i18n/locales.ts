/**
 * Migration window translations
 * Supports Chinese (zh-CN) and English (en-US)
 */

export const zhCN = {
  migration: {
    title: '数据迁移向导',
    stages: {
      introduction: '介绍',
      backup: '备份',
      migration: '迁移',
      completed: '完成'
    },
    steps: {
      start: '开始',
      backup: '备份',
      migrate: '迁移',
      complete: '完成'
    },
    buttons: {
      cancel: '取消',
      next: '下一步',
      create_backup: '创建备份',
      backup_completed: '已完成备份',
      confirm_backup: '我已备份，开始迁移',
      start_migration: '开始迁移',
      confirm: '确定',
      restart: '重启应用',
      retry: '重试',
      exit: '退出',
      close: '关闭应用',
      ignore_migration: '忽略并使用默认值',
      backing_up: '正在备份...',
      migrating: '迁移中...'
    },
    status: {
      pending: '等待中',
      running: '进行中',
      completed: '完成',
      failed: '失败'
    },
    introduction: {
      title: '将数据迁移到新的架构中',
      description_1: 'Cherry Studio对数据的存储和使用方式进行了重大重构，在新的架构下，效率和安全性将会得到极大提升。',
      description_2: '数据必须进行迁移，才能在新版本中使用。',
      description_3: '我们会指导你完成迁移，迁移过程不会损坏原来的数据，你随时可以取消迁移，并继续使用旧版本。'
    },
    backup_required: {
      title: '创建数据备份',
      description: '迁移前必须创建数据备份以确保数据安全。请选择备份位置或确认已有最新备份。'
    },
    backup_progress: {
      title: '准备数据备份',
      description: '请选择备份位置，保存后等待备份完成。'
    },
    backup_confirmed: {
      title: '备份完成',
      description: '数据备份已完成，现在可以安全地开始迁移。'
    },
    migration: {
      title: '正在迁移数据...'
    },
    progress: {
      processing: '正在处理{{name}}...',
      migrated_boot_config: '已迁移 {{processed}}/{{total}} 条启动配置',
      migrated_chats: '已迁移 {{processed}}/{{total}} 个对话，{{messages}} 条消息',
      migrated_preferences: '已迁移 {{processed}}/{{total}} 条配置',
      migrated_knowledge: '已迁移 {{processed}}/{{total}} 条知识库记录',
      migrated_knowledge_vectors: '已迁移 {{processed}}/{{total}} 个知识库向量工作单元'
    },
    migration_completed: {
      title: '数据迁移完成！',
      description: '所有数据已成功迁移到新架构，请点击确定继续。'
    },
    completed: {
      title: '迁移完成',
      description: '数据已成功迁移，重启应用后即可正常使用。'
    },
    error: {
      title: '迁移失败',
      description: '迁移过程遇到错误，您可以重新尝试或继续使用之前版本（原始数据完好保存）。',
      error_prefix: '错误信息：'
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
      ignore_hint: '您也可以选择忽略旧数据，直接以全新默认配置启动。',
      confirm_ignore: '这将放弃所有旧数据并以全新默认值启动，继续后将重启应用。确定继续吗？'
    }
  }
}

export const enUS = {
  migration: {
    title: 'Data Migration Wizard',
    stages: {
      introduction: 'Introduction',
      backup: 'Backup',
      migration: 'Migration',
      completed: 'Completed'
    },
    steps: {
      start: 'Start',
      backup: 'Backup',
      migrate: 'Migrate',
      complete: 'Complete'
    },
    buttons: {
      cancel: 'Cancel',
      next: 'Next',
      create_backup: 'Create Backup',
      backup_completed: 'Backup Completed',
      confirm_backup: 'I Have Backup, Start Migration',
      start_migration: 'Start Migration',
      confirm: 'OK',
      restart: 'Restart App',
      retry: 'Retry',
      exit: 'Exit',
      close: 'Close App',
      ignore_migration: 'Ignore and Use Defaults',
      backing_up: 'Backing up...',
      migrating: 'Migrating...'
    },
    status: {
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed'
    },
    introduction: {
      title: 'Migrate Data to New Architecture',
      description_1:
        'Cherry Studio has undergone a major refactoring of data storage and usage. The new architecture will greatly improve efficiency and security.',
      description_2: 'Data migration is required to use the new version.',
      description_3:
        'We will guide you through the migration process. The migration will not damage your original data, and you can cancel at any time and continue using the old version.'
    },
    backup_required: {
      title: 'Create Data Backup',
      description:
        'A data backup must be created before migration to ensure data safety. Please select a backup location or confirm you have a recent backup.'
    },
    backup_progress: {
      title: 'Preparing Data Backup',
      description: 'Please select a backup location, save, and wait for the backup to complete.'
    },
    backup_confirmed: {
      title: 'Backup Completed',
      description: 'Data backup has been completed. You can now safely start the migration.'
    },
    migration: {
      title: 'Migrating Data...'
    },
    progress: {
      processing: 'Processing {{name}}...',
      migrated_boot_config: 'Migrated {{processed}}/{{total}} boot config items',
      migrated_chats: 'Migrated {{processed}}/{{total}} conversations, {{messages}} messages',
      migrated_preferences: 'Migrated {{processed}}/{{total}} preferences',
      migrated_knowledge: 'Migrated {{processed}}/{{total}} knowledge records',
      migrated_knowledge_vectors: 'Migrated {{processed}}/{{total}} knowledge vector work units'
    },
    migration_completed: {
      title: 'Data Migration Completed!',
      description: 'All data has been successfully migrated to the new architecture. Please click OK to continue.'
    },
    completed: {
      title: 'Migration Completed',
      description: 'Data has been successfully migrated. The application will work normally after restart.'
    },
    error: {
      title: 'Migration Failed',
      description:
        'An error occurred during migration. You can retry or continue using the previous version (original data is intact).',
      error_prefix: 'Error: '
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
      ignore_hint: 'You can also choose to ignore old data and start fresh with default settings.',
      confirm_ignore:
        'This will discard all previous data and start fresh with defaults. The app will restart after confirming. Continue?'
    }
  }
}
