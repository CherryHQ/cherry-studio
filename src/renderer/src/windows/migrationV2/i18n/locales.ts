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
    buttons: {
      cancel: '取消',
      next: '下一步',
      create_backup: '创建备份',
      confirm_backup: '我已备份，开始迁移',
      start_migration: '开始迁移',
      confirm: '确定',
      restart: '重启应用',
      retry: '重新尝试',
      close: '关闭应用',
      backing_up: '正在备份...',
      migrating: '迁移进行中...'
    },
    status: {
      pending: '等待中',
      running: '进行中',
      completed: '完成',
      failed: '失败'
    },
    introduction: {
      title: '将数据迁移到新的架构中',
      description_1:
        'Cherry Studio对数据的存储和使用方式进行了重大重构，在新的架构下，效率和安全性将会得到极大提升。',
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
    buttons: {
      cancel: 'Cancel',
      next: 'Next',
      create_backup: 'Create Backup',
      confirm_backup: 'I Have Backup, Start Migration',
      start_migration: 'Start Migration',
      confirm: 'OK',
      restart: 'Restart App',
      retry: 'Retry',
      close: 'Close App',
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
    }
  }
}
