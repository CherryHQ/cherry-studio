#!/usr/bin/env node

const PreferencesGenerator = require('./generate-preferences')
const BootConfigGenerator = require('./generate-boot-config')
const MigrationGenerator = require('./generate-migration')

async function generateAll() {
  console.log('🚀 开始生成代码...\n')

  try {
    // 步骤1: 生成preferences.ts
    console.log('📋 步骤 1/3: 生成preferences.ts')
    const preferencesGenerator = new PreferencesGenerator()
    preferencesGenerator.generate()
    console.log('✅ preferences.ts 生成完成\n')

    // 步骤2: 生成bootConfigSchemas.ts
    console.log('📋 步骤 2/3: 生成bootConfigSchemas.ts')
    const bootConfigGenerator = new BootConfigGenerator()
    bootConfigGenerator.generate()
    console.log('✅ bootConfigSchemas.ts 生成完成\n')

    // 步骤3: 生成迁移代码
    console.log('🔄 步骤 3/3: 生成迁移代码')
    const migrationGenerator = new MigrationGenerator()
    migrationGenerator.generate()
    console.log('✅ 迁移代码生成完成\n')

    // 成功总结
    console.log('🎉 所有代码生成成功！')
    console.log('\n📝 生成的文件:')
    console.log('   - packages/shared/data/preference/preferenceSchemas.ts')
    console.log('   - packages/shared/data/bootConfig/bootConfigSchemas.ts')
    console.log('   - src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts')
    console.log('   - src/main/data/migration/v2/migrators/mappings/BootConfigMappings.ts')

    console.log('\n🔧 下一步操作:')
    console.log('   1. 运行 pnpm typecheck 检查类型')
    console.log('   2. 运行 pnpm lint 格式化代码')
    console.log('   3. 测试迁移代码的功能')
  } catch (error) {
    console.error('❌ 生成过程中发生错误:', error.message)
    process.exit(1)
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  generateAll()
}

module.exports = generateAll
