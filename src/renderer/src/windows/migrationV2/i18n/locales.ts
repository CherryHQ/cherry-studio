/**
 * Migration window translations
 * Supports Chinese (zh-CN) and English (en-US)
 */

export const zhCN = {
  migration: {
    title: '数据迁移',
    header: {
      kicker: 'V2 升级流程',
      meta: '数据层升级',
      subtitle: '以分步骤方式将本地数据迁移到新架构',
      badge: '一次性迁移'
    },
    stages: {
      introduction: '概览',
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
    flow: {
      current: '当前步骤',
      overview: {
        label: '概览',
        description: '先了解会迁移什么，以及整个流程如何进行'
      },
      backup: {
        label: '备份',
        description: '创建或确认恢复点，确保这次升级可回退'
      },
      migrate: {
        label: '迁移',
        description: '导出旧数据，并逐个模块迁移到 v2'
      },
      finish: {
        label: '完成',
        description: '确认结果并重启，切换到新架构'
      }
    },
    footer: {
      step: '步骤 {{current}} / {{total}}',
      introduction: '先确认迁移内容，再继续。',
      backup_required: '迁移前需要一个可恢复的备份。',
      backup_required_create: '推荐先创建一个新的恢复点。',
      backup_required_existing: '确认你现有的备份足够新再继续。',
      backup_in_progress: '正在创建备份压缩包，请保持窗口开启。',
      backup_ready: '备份已确认，可以开始正式迁移。',
      preparing_migration: '正在导出旧数据并准备迁移输入，请保持窗口开启。',
      migration_in_progress: '正在按顺序迁移各个模块。',
      migration_succeeded: '迁移已完成，确认后进入最后一步。',
      restart_required: '所有准备已完成，重启应用即可进入 v2。',
      failed: '迁移已停止，原始数据仍然保留。'
    },
    language: {
      label: '界面语言'
    },
    buttons: {
      cancel: '取消',
      back: '上一步',
      next: '下一步',
      create_backup: '创建备份',
      backup_completed: '已完成备份',
      confirm_backup: '我已经有备份',
      start_migration: '开始迁移',
      confirm: '确认结果',
      restart: '重启 Cherry Studio',
      retry: '重试',
      exit: '退出',
      close: '关闭窗口',
      backing_up: '正在备份...',
      migrating: '迁移中...'
    },
    status: {
      pending: '等待中',
      running: '进行中',
      completed: '已完成',
      failed: '失败'
    },
    overview: {
      badge: '一次性升级',
      title: '把数据切换到 v2',
      description: '这个引导会完成备份、迁移和校验，然后再交给你重启应用。',
      highlights: {
        scope: {
          title: '迁移聊天、助手和设置',
          description: '常用数据会一起搬到新的数据层。'
        },
        safety: {
          title: '原始数据会先保留',
          description: '完成前不会直接替换你现在的数据。'
        }
      },
      scope: {
        title: '会迁移哪些内容',
        description: '迁移会覆盖你日常使用的核心数据。',
        item_1: '偏好设置与应用配置',
        item_2: '助手与预设',
        item_3: '知识库记录',
        item_4: '对话与消息历史'
      },
      safety: {
        title: '有哪些保护措施',
        description: '流程设计的重点是可恢复和可验证。',
        item_1: '迁移过程中不会直接删除原始数据',
        item_2: '在正式开始迁移前，你随时可以退出',
        item_3: '备份会为你保留一个明确的恢复点'
      },
      plan: {
        title: '接下来会发生什么',
        description: '整个升级流程被拆成四个连续步骤。',
        item_1: '确认迁移范围',
        item_2: '创建或确认 ZIP 备份',
        item_3: '导出旧数据并执行各个 migrator',
        item_4: '检查结果并重启应用'
      }
    },
    introduction: {
      title: '将数据迁移到新的架构中',
      description_1: 'Cherry Studio 对数据存储和使用方式进行了重构，新架构会带来更好的稳定性和可维护性。',
      description_2: '要继续使用新版本，需要先完成这次迁移。',
      description_3: '这个窗口会分步骤引导你完成整个流程。'
    },
    backup: {
      badge: '先建立恢复点',
      title: '先确认备份方式',
      description: '选择继续前的恢复方式。这里只需要做一个决定。',
      progress_title: '正在创建备份压缩包',
      progress_description: '选择 ZIP 保存位置后，等待窗口确认备份完成。',
      progress_hint: 'Cherry Studio 正在写入新的恢复点，请保持窗口开启。',
      ready_title: '备份已确认',
      ready_description: '现在已经有恢复点，可以开始迁移。',
      selected: {
        create: '新的 ZIP 备份已经准备好，迁移可以继续。',
        existing: '你选择使用现有备份，迁移可以继续。'
      },
      primary: {
        title: '创建新的备份',
        description: '在继续前生成一个最新的 ZIP 恢复点。',
        badge: '推荐',
        item_1: '选择一个可写入的位置保存 ZIP 文件',
        item_2: '备份完成前不要强制退出应用',
        item_3: '把 ZIP 放到之后容易找到的位置'
      },
      secondary: {
        title: '使用现有备份',
        description: '只在你确认备份足够新时才跳过重新创建。',
        item_1: '确认它包含最近的聊天记录和设置',
        item_2: '尽量不要使用旧版本导出的备份',
        item_3: '如果拿不准，最好重新创建一次'
      },
      selection_hint_create: '会先创建新的 ZIP 备份，然后再进入正式迁移。',
      selection_hint_existing: '继续前请确认现有备份包含最近的聊天记录和设置。',
      guardrails: {
        title: '继续前请注意',
        description: '下面这些约束可以降低迁移风险。',
        item_1: '备份和迁移阶段都不要强制关闭窗口',
        item_2: '知识库数据越多，整个流程耗时可能越长',
        item_3: '完成前 Cherry Studio 会保留原始数据'
      }
    },
    backup_required: {
      title: '创建数据备份',
      description: '迁移前必须先创建数据备份，或者确认你已经有一份可恢复的最新备份。'
    },
    backup_in_progress: {
      title: '准备数据备份',
      description: '请选择备份位置并等待备份完成。'
    },
    backup_ready: {
      title: '备份完成',
      description: '备份已经完成，可以继续开始迁移。'
    },
    migration_run: {
      badge: '数据搬运中',
      title: '正在把旧数据转入新架构',
      description: '当前步骤会导出旧数据并按顺序执行 migrator。',
      checklist_title: '迁移检查清单',
      checklist_description: '每个模块完成后都会记录状态，失败时也会保留上下文。',
      empty: '迁移开始后，这里会显示每个模块的执行状态。',
      summary: {
        overall_progress: '总进度',
        active_migrator: '当前模块',
        completed_modules: '已完成模块',
        current_operation: '当前操作',
        idle: '准备中',
        done: '全部完成',
        modules_count: '已完成 {{completed}} / {{total}}',
        modules_hint: '完成所有模块后才能进入最后一步'
      }
    },
    preparing_migration: {
      title: '正在准备迁移数据...'
    },
    migration_in_progress: {
      title: '正在迁移数据...'
    },
    progress: {
      preparing_export: '正在整理旧数据并准备导出...',
      processing: '正在处理 {{name}}...',
      exporting_table: '正在导出 {{table}}（{{current}}/{{total}}）',
      starting_engine: '旧数据导出完成，正在启动迁移...',
      migrated_chats: '已迁移 {{processed}}/{{total}} 个对话，{{messages}} 条消息',
      migrated_preferences: '已迁移 {{processed}}/{{total}} 条配置'
    },
    tables: {
      redux_state: 'Redux 状态',
      topics: '对话数据',
      files: '文件索引',
      knowledge_notes: '知识库记录',
      message_blocks: '消息块',
      settings: '设置表',
      translate_history: '翻译历史',
      quick_phrases: '快捷短语',
      translate_languages: '翻译语言'
    },
    migration_succeeded: {
      badge: '迁移已完成',
      title: '数据已经迁移完成',
      description: '所有模块都已完成，确认结果后进入重启阶段。'
    },
    restart_required: {
      badge: '等待重启',
      title: '迁移已完成，请重启应用',
      description: '数据迁移已经完成。重启 Cherry Studio 后，应用会切换到新的数据架构。',
      restart: {
        title: '下一步只需要重启',
        description: '重启后应用会切换到新的数据层。'
      },
      safety: {
        title: '当前状态',
        description: '迁移已经完成，原始数据在流程中也保持了安全边界。',
        item_1: '如果需要排查问题，备份仍然可以作为恢复点',
        item_2: '迁移记录会帮助你定位是否存在异常'
      },
      next: {
        title: '重启后建议检查',
        description: '进入应用后，可以快速确认几个关键区域。',
        item_1: '检查最近的聊天记录和助手是否可见',
        item_2: '如有异常，先保留日志和备份再进一步处理'
      }
    },
    failed: {
      badge: '迁移中断',
      title: '迁移失败',
      description: '迁移过程中遇到了错误。你可以重试，原始数据和备份仍然保留。',
      error_prefix: '错误信息：',
      details_label: '技术详情',
      unknown: '未知错误',
      retry_hint: '优先从这个窗口重试；如果问题持续，请保留日志和备份。',
      recovery_title: '建议的恢复动作',
      recovery_description: '在继续操作之前，先确认你保留了备份与当前环境。',
      recovery_item_1: '不要删除本地原始数据或刚创建的备份文件',
      recovery_item_2: '优先使用重试，避免手动修改迁移产生的临时文件',
      recovery_item_3: '如果问题持续，保留日志与错误信息便于后续排查'
    }
  }
}

export const enUS = {
  migration: {
    title: 'Data Migration',
    header: {
      kicker: 'V2 upgrade flow',
      meta: 'Data layer upgrade',
      subtitle: 'Move local data into the new architecture step by step',
      badge: 'One-time migration'
    },
    stages: {
      introduction: 'Overview',
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
    flow: {
      current: 'Current step',
      overview: {
        label: 'Overview',
        description: 'Review what changes and how the upgrade will run'
      },
      backup: {
        label: 'Backup',
        description: 'Create or confirm a recovery point before continuing'
      },
      migrate: {
        label: 'Migrate',
        description: 'Export legacy data and move it into v2'
      },
      finish: {
        label: 'Finish',
        description: 'Review the result and restart safely'
      }
    },
    footer: {
      step: 'Step {{current}} / {{total}}',
      introduction: 'Review what will move before you continue.',
      backup_required: 'A recoverable backup is required before migration can start.',
      backup_required_create: 'Create a fresh recovery point before the migration begins.',
      backup_required_existing: 'Confirm your existing backup is recent before continuing.',
      backup_in_progress: 'Creating the backup archive. Keep this window open.',
      backup_ready: 'Backup confirmed. The migration can start now.',
      preparing_migration: 'Preparing legacy data exports for the migration. Keep this window open.',
      migration_in_progress: 'Migrating each module into the new architecture.',
      migration_succeeded: 'Migration is complete. Confirm the result to continue.',
      restart_required: 'Everything is ready. Restart the app to enter v2.',
      failed: 'Migration stopped before replacing your original data.'
    },
    language: {
      label: 'Language'
    },
    buttons: {
      cancel: 'Cancel',
      back: 'Back',
      next: 'Next',
      create_backup: 'Create backup',
      backup_completed: 'Backup completed',
      confirm_backup: 'I already have a backup',
      start_migration: 'Start migration',
      confirm: 'Confirm result',
      restart: 'Restart Cherry Studio',
      retry: 'Retry',
      exit: 'Exit',
      close: 'Close window',
      backing_up: 'Backing up...',
      migrating: 'Migrating...'
    },
    status: {
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed'
    },
    overview: {
      badge: 'One-time upgrade',
      title: 'Move your data into v2',
      description: 'This flow handles backup, migration, and validation before you restart the app.',
      highlights: {
        scope: {
          title: 'Move chats, assistants, and settings',
          description: 'The core data you use every day moves together.'
        },
        safety: {
          title: 'Keep the original data in place first',
          description: 'Nothing replaces your current data until the flow is complete.'
        }
      },
      scope: {
        title: 'What will move',
        description: 'The migration covers the core data you use every day.',
        item_1: 'Preferences and app settings',
        item_2: 'Assistants and presets',
        item_3: 'Knowledge base records',
        item_4: 'Chats and message history'
      },
      safety: {
        title: 'What keeps it safe',
        description: 'The flow is designed around recovery and verification.',
        item_1: 'Original data is not deleted during the migration',
        item_2: 'You can exit before the actual migration starts',
        item_3: 'A backup gives you a clear recovery point'
      },
      plan: {
        title: 'What happens next',
        description: 'The upgrade is broken into four consecutive steps.',
        item_1: 'Confirm the migration scope',
        item_2: 'Create or confirm a ZIP backup',
        item_3: 'Export legacy data and run each migrator',
        item_4: 'Review the result and restart the app'
      }
    },
    introduction: {
      title: 'Migrate data to the new architecture',
      description_1:
        'Cherry Studio has refactored how data is stored and used. The new architecture improves reliability and maintainability.',
      description_2: 'To keep using the new version, this migration needs to finish first.',
      description_3: 'This window will guide you through the flow step by step.'
    },
    backup: {
      badge: 'Create a recovery point first',
      title: 'Choose how to protect this migration',
      description: 'Pick the recovery path you want before the migration begins.',
      progress_title: 'Creating your backup archive',
      progress_description: 'Choose where to save the ZIP file, then wait for Cherry Studio to confirm the backup.',
      progress_hint: 'Cherry Studio is writing a fresh recovery point now. Keep this window open.',
      ready_title: 'Backup confirmed',
      ready_description: 'You now have a recovery point, so the migration can start.',
      selected: {
        create: 'A new ZIP backup is ready, and the migration can continue.',
        existing: 'You chose to continue with your existing backup.'
      },
      primary: {
        title: 'Create a new backup',
        description: 'Generate a fresh ZIP recovery point before you continue.',
        badge: 'Recommended',
        item_1: 'Choose a writable location for the ZIP file',
        item_2: 'Do not force quit the app while the archive is being created',
        item_3: 'Store the ZIP somewhere you can find again later'
      },
      secondary: {
        title: 'Use an existing backup',
        description: 'Only skip a fresh archive if you know the current backup is recent.',
        item_1: 'Confirm it includes recent chats and settings',
        item_2: 'Avoid backups exported from much older app versions',
        item_3: 'If you are unsure, create a new backup now'
      },
      selection_hint_create: 'A new ZIP backup will be created before the migration starts.',
      selection_hint_existing: 'Make sure the current backup includes your latest chats and settings.',
      guardrails: {
        title: 'Keep these constraints in mind',
        description: 'A few guardrails make the upgrade more stable.',
        item_1: 'Do not force close the window during backup or migration',
        item_2: 'Large knowledge bases can make the flow take longer',
        item_3: 'Cherry Studio keeps the original data until the flow completes'
      }
    },
    backup_required: {
      title: 'Create data backup',
      description:
        'Before migration can continue, create a backup or confirm that you already have a recent recovery point.'
    },
    backup_in_progress: {
      title: 'Preparing data backup',
      description: 'Choose a backup destination and wait for the archive to finish.'
    },
    backup_ready: {
      title: 'Backup completed',
      description: 'The backup is ready. You can now start the migration.'
    },
    migration_run: {
      badge: 'Data transfer in progress',
      title: 'Moving legacy data into the new architecture',
      description: 'Cherry Studio exports the old data, then runs each migrator in order.',
      checklist_title: 'Migration checklist',
      checklist_description:
        'Each module reports its own status so you can see what finished and what still needs attention.',
      empty: 'Migration tasks will appear here after the engine starts.',
      summary: {
        overall_progress: 'Overall progress',
        active_migrator: 'Active module',
        completed_modules: 'Completed modules',
        current_operation: 'Current operation',
        idle: 'Preparing',
        done: 'Done',
        modules_count: '{{completed}} / {{total}} completed',
        modules_hint: 'All modules must finish before the last step unlocks'
      }
    },
    preparing_migration: {
      title: 'Preparing migration data...'
    },
    migration_in_progress: {
      title: 'Migrating data...'
    },
    progress: {
      preparing_export: 'Collecting legacy data and preparing the export...',
      processing: 'Processing {{name}}...',
      exporting_table: 'Exporting {{table}} ({{current}}/{{total}})',
      starting_engine: 'Legacy data export is complete. Starting migration...',
      migrated_chats: 'Migrated {{processed}}/{{total}} conversations, {{messages}} messages',
      migrated_preferences: 'Migrated {{processed}}/{{total}} preferences'
    },
    tables: {
      redux_state: 'Redux state',
      topics: 'Conversations',
      files: 'File index',
      knowledge_notes: 'Knowledge notes',
      message_blocks: 'Message blocks',
      settings: 'Settings table',
      translate_history: 'Translation history',
      quick_phrases: 'Quick phrases',
      translate_languages: 'Translation languages'
    },
    migration_succeeded: {
      badge: 'Migration finished',
      title: 'Data migration is complete',
      description: 'All modules have finished. Confirm the result to continue.'
    },
    restart_required: {
      badge: 'Restart required',
      title: 'Migration is complete. Restart the app',
      description:
        'Data migration has finished. After you restart Cherry Studio, the app will switch to the new data architecture.',
      restart: {
        title: 'Restart is the last step',
        description: 'After restart, the app reads from the new data layer.'
      },
      safety: {
        title: 'Current status',
        description: 'The migration finished, and the original data remained behind a safety boundary during the flow.',
        item_1: 'Your backup is still the fastest recovery point if you need it',
        item_2: 'Migration records help with troubleshooting if anything looks wrong'
      },
      next: {
        title: 'What to check after restart',
        description: 'Once the app opens again, verify a few high-value areas.',
        item_1: 'Confirm recent chats and assistants are visible',
        item_2: 'If something looks wrong, keep the logs and backup before taking further action'
      }
    },
    failed: {
      badge: 'Migration interrupted',
      title: 'Migration failed',
      description: 'Something went wrong during the migration. Your current data and backup are still intact.',
      error_prefix: 'Error: ',
      details_label: 'Technical details',
      unknown: 'Unknown error',
      retry_hint: 'Retry from this window first. If the issue continues, keep the logs and backup.',
      recovery_title: 'Suggested recovery steps',
      recovery_description: 'Before you continue, make sure you keep the backup and the current environment intact.',
      recovery_item_1: 'Do not delete the original local data or the backup archive you just created',
      recovery_item_2: 'Prefer retrying from this window instead of editing temporary migration files manually',
      recovery_item_3: 'If the issue continues, keep the logs and error details for follow-up debugging'
    }
  }
}
