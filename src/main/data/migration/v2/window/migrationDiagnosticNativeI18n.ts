import { createInstance } from 'i18next'

export type MigrationDiagnosticNativeLocale = 'en-US' | 'zh-CN'

const resources = {
  'en-US': {
    translation: {
      action: {
        save: 'Save diagnostic bundle',
        savePrevious: 'Save previous diagnostic bundle',
        retry: 'Retry',
        retryMigration: 'Retry migration',
        useDefault: 'Use default directory',
        exit: 'Exit'
      },
      failure: {
        title: 'Migration diagnostics',
        path_resolution_failed: 'Cherry Studio could not resolve the migration data location.',
        legacy_data_location_unavailable: 'The previous custom data directory is not currently accessible.',
        data_location_pin_failed: 'Cherry Studio could not save the selected data location.',
        diagnostics_journal_failed: 'Cherry Studio could not prepare migration diagnostics.',
        database_initialize_failed: 'Cherry Studio could not initialize the migration database.',
        migration_status_probe_failed: 'Cherry Studio could not check the migration status.',
        version_check_failed: 'Cherry Studio could not verify the required upgrade path.',
        version_window_failed: 'Cherry Studio could not open the upgrade guidance window.',
        migration_window_failed: 'Cherry Studio could not open the migration window.',
        renderer_process_gone: 'The migration window stopped unexpectedly.',
        renderer_unresponsive: 'The migration window stopped responding.',
        code: 'Diagnostic code: {{code}}'
      },
      recovery: {
        title: 'Previous migration interrupted',
        message: 'Cherry Studio found diagnostics from an unfinished migration. You can save them before retrying.'
      },
      save: {
        title: 'Save migration diagnostic bundle',
        savedTitle: 'Diagnostic bundle saved',
        savedMessage: 'The diagnostic bundle was saved. Attach it when contacting the Cherry Studio developers.',
        failedTitle: 'Could not save diagnostic bundle',
        failedMessage: 'The diagnostic bundle could not be saved. No data was uploaded or sent.'
      },
      support: {
        emailSubject: 'Cherry Studio migration diagnostics',
        emailBody: 'Please describe the migration issue and manually attach the saved diagnostic ZIP.'
      }
    }
  },
  'zh-CN': {
    translation: {
      action: {
        save: '保存诊断包',
        savePrevious: '保存上次诊断包',
        retry: '重试',
        retryMigration: '重试迁移',
        useDefault: '使用默认目录',
        exit: '退出'
      },
      failure: {
        title: '迁移诊断',
        path_resolution_failed: '无法确定迁移数据目录。',
        legacy_data_location_unavailable: '之前的自定义数据目录当前不可访问。',
        data_location_pin_failed: '无法保存选定的数据目录。',
        diagnostics_journal_failed: '无法准备迁移诊断信息。',
        database_initialize_failed: '无法初始化迁移数据库。',
        migration_status_probe_failed: '无法检查迁移状态。',
        version_check_failed: '无法验证必需的升级路径。',
        version_window_failed: '无法打开升级指引窗口。',
        migration_window_failed: '无法打开迁移窗口。',
        renderer_process_gone: '迁移窗口意外停止运行。',
        renderer_unresponsive: '迁移窗口已停止响应。',
        code: '诊断代码：{{code}}'
      },
      recovery: {
        title: '上次迁移已中断',
        message: '检测到未完成迁移的诊断信息。您可以在重试前先保存诊断包。'
      },
      save: {
        title: '保存迁移诊断包',
        savedTitle: '诊断包已保存',
        savedMessage: '诊断包已保存。联系 Cherry Studio 开发者时请手动附上该文件。',
        failedTitle: '无法保存诊断包',
        failedMessage: '诊断包保存失败。未上传或发送任何数据。'
      },
      support: {
        emailSubject: 'Cherry Studio 迁移诊断',
        emailBody: '请描述迁移问题，并手动附上已保存的诊断 ZIP 文件。'
      }
    }
  }
} as const

export interface MigrationDiagnosticNativeI18n {
  readonly locale: MigrationDiagnosticNativeLocale
  t(key: string, params?: Readonly<Record<string, string | number>>): string
}

function normalizeLocale(locale: string): MigrationDiagnosticNativeLocale {
  const normalized = locale.replace('_', '-').toLowerCase()
  if (normalized === 'zh-cn' || normalized === 'zh-hans') return 'zh-CN'
  return 'en-US'
}

export async function createMigrationDiagnosticNativeI18n(locale: string): Promise<MigrationDiagnosticNativeI18n> {
  const resolvedLocale = normalizeLocale(locale)
  const instance = createInstance()
  await instance.init({
    lng: resolvedLocale,
    fallbackLng: 'en-US',
    resources,
    interpolation: { escapeValue: false },
    initImmediate: false
  })

  return Object.freeze({
    locale: resolvedLocale,
    t: (key: string, params?: Readonly<Record<string, string | number>>) => instance.t(key, params)
  })
}
