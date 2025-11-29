#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

class SimpleMappingGenerator {
  constructor() {
    this.dataDir = path.resolve(__dirname, '../data')
    this.targetDir = path.resolve(__dirname, '../../../../src/main/data/migration/v2/migrators/mappings')
    this.classificationFile = path.join(this.dataDir, 'classification.json')
  }

  generate() {
    console.log('开始生成简化的映射关系代码...')

    // 读取分类数据
    const classification = this.loadClassification()

    // 提取preferences相关数据
    const preferencesData = this.extractPreferencesData(classification)

    // 创建目标目录
    this.ensureTargetDirectory()

    // 生成映射关系文件
    this.generateMappings(preferencesData)

    console.log('映射关系生成完成！')
    this.printSummary(preferencesData)
  }

  loadClassification() {
    if (!fs.existsSync(this.classificationFile)) {
      throw new Error(`分类文件不存在: ${this.classificationFile}`)
    }

    const content = fs.readFileSync(this.classificationFile, 'utf8')
    return JSON.parse(content)
  }

  extractPreferencesData(classification) {
    const allPreferencesData = []
    const sources = ['electronStore', 'redux', 'localStorage']

    // 递归提取项目，包括children (保持现有逻辑)
    const extractItems = (items, source, category, parentKey = '') => {
      if (!Array.isArray(items)) return

      items.forEach((item) => {
        // 处理有children的项目
        if (item.children && Array.isArray(item.children)) {
          console.log(`处理children项: ${source}/${category}/${item.originalKey}`)
          extractItems(item.children, source, category, `${parentKey}${item.originalKey}.`)
          return
        }

        // 处理普通项目
        if (item.category === 'preferences' && item.status === 'classified' && item.targetKey) {
          allPreferencesData.push({
            ...item,
            source,
            sourceCategory: category,
            originalKey: parentKey + item.originalKey, // 包含父级路径
            fullPath: `${source}/${category}/${parentKey}${item.originalKey}`
          })
        }
      })
    }

    sources.forEach((source) => {
      if (classification.classifications[source]) {
        Object.keys(classification.classifications[source]).forEach((category) => {
          const items = classification.classifications[source][category]
          extractItems(items, source, category)
        })
      }
    })

    console.log(`提取到 ${allPreferencesData.length} 个preferences项（包含children）`)

    // 处理重复的targetKey，优先使用redux数据
    const targetKeyGroups = {}
    allPreferencesData.forEach((item) => {
      if (!targetKeyGroups[item.targetKey]) {
        targetKeyGroups[item.targetKey] = []
      }
      targetKeyGroups[item.targetKey].push(item)
    })

    // 去重：按redux > localStorage > electronStore优先级选择
    const sourcePriority = { redux: 3, localStorage: 2, electronStore: 1 }
    const deduplicatedData = []

    Object.keys(targetKeyGroups).forEach((targetKey) => {
      const items = targetKeyGroups[targetKey]
      if (items.length > 1) {
        console.log(`发现重复targetKey: ${targetKey}，共${items.length}项`)
        items.forEach((item) => console.log(`  - ${item.fullPath}`))

        // 按优先级排序，选择最高优先级的项
        items.sort((a, b) => sourcePriority[b.source] - sourcePriority[a.source])
        const selected = items[0]
        console.log(`  选择: ${selected.fullPath}`)
        deduplicatedData.push(selected)
      } else {
        deduplicatedData.push(items[0])
      }
    })

    console.log(`去重后剩余 ${deduplicatedData.length} 个preferences项`)

    // 按数据源分组
    const preferencesData = {
      electronStore: [],
      redux: [],
      localStorage: [],
      all: deduplicatedData
    }

    deduplicatedData.forEach((item) => {
      if (preferencesData[item.source]) {
        preferencesData[item.source].push(item)
      }
    })

    return preferencesData
  }

  ensureTargetDirectory() {
    if (!fs.existsSync(this.targetDir)) {
      fs.mkdirSync(this.targetDir, { recursive: true })
    }
  }

  generateMappings(preferencesData) {
    // 生成ElectronStore映射 - 简单结构，不需要sourceCategory
    const electronStoreMappings = preferencesData.electronStore.map((item) => ({
      originalKey: item.originalKey,
      targetKey: item.targetKey
    }))

    // 生成Redux映射 - 按category分组
    const reduxMappings = {}
    preferencesData.redux.forEach((item) => {
      if (!reduxMappings[item.sourceCategory]) {
        reduxMappings[item.sourceCategory] = []
      }
      reduxMappings[item.sourceCategory].push({
        originalKey: item.originalKey, // 可能包含嵌套路径，如"codeEditor.enabled"
        targetKey: item.targetKey
      })
    })

    // 生成映射关系文件内容
    const content = `/**
 * Auto-generated preference mappings from classification.json
 * Generated at: ${new Date().toISOString()}
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
export const ELECTRON_STORE_MAPPINGS = ${JSON.stringify(electronStoreMappings, null, 2)} as const

/**
 * Redux Store映射关系 - 按category分组，支持嵌套路径
 * 
 * Redux Store可能有children结构，originalKey可能包含嵌套路径:
 * - 直接字段: "theme" -> reduxData.settings.theme
 * - 嵌套字段: "codeEditor.enabled" -> reduxData.settings.codeEditor.enabled
 * - 多层嵌套: "exportMenuOptions.docx" -> reduxData.settings.exportMenuOptions.docx
 */
export const REDUX_STORE_MAPPINGS = ${JSON.stringify(reduxMappings, null, 2)} as const

// === AUTO-GENERATED CONTENT END ===

/**
 * 映射统计:
 * - ElectronStore项: ${electronStoreMappings.length}
 * - Redux Store项: ${preferencesData.redux.length}
 * - Redux分类: ${Object.keys(reduxMappings).join(', ')}
 * - 总配置项: ${preferencesData.all.length}
 * 
 * 使用说明:
 * 1. ElectronStore读取: configManager.get(mapping.originalKey)  
 * 2. Redux读取: 需要解析嵌套路径 reduxData[category][originalKey路径]
 * 3. 默认值: 从defaultPreferences.default[mapping.targetKey]获取
 */`

    // 写入文件
    const targetFile = path.join(this.targetDir, 'PreferencesMappings.ts')
    fs.writeFileSync(targetFile, content, 'utf8')

    console.log(`映射关系文件已生成: ${targetFile}`)
  }

  printSummary(preferencesData) {
    console.log(`\n生成摘要:`)
    console.log(`- 输出文件: PreferencesMappings.ts`)
    console.log(`- ElectronStore映射: ${preferencesData.electronStore.length}`)
    console.log(`- Redux Store映射: ${preferencesData.redux.length}`)
    console.log(`- 总配置项: ${preferencesData.all.length}`)

    // 显示Redux分类
    const reduxCategories = [...new Set(preferencesData.redux.map((item) => item.sourceCategory))]
    console.log(`- Redux分类: ${reduxCategories.join(', ')}`)

    // 显示一些嵌套路径的例子
    const nestedKeys = preferencesData.redux
      .filter((item) => item.originalKey.includes('.'))
      .slice(0, 5)
      .map((item) => item.originalKey)

    if (nestedKeys.length > 0) {
      console.log(`\n嵌套路径示例:`)
      nestedKeys.forEach((key) => console.log(`  - ${key}`))
    }
  }
}

// 主执行逻辑
if (require.main === module) {
  try {
    const generator = new SimpleMappingGenerator()
    generator.generate()
  } catch (error) {
    console.error('生成失败:', error.message)
    process.exit(1)
  }
}

module.exports = SimpleMappingGenerator
