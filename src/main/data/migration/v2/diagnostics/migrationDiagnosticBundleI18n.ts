import resources from './migrationDiagnosticBundleI18n.json'

export function createMigrationDiagnosticBundleReadme(): string {
  return `${resources['en-US'].readme}\n\n${resources['zh-CN'].readme}\n`
}
