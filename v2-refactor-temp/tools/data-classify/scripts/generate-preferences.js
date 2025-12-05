#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

class PreferencesGenerator {
  constructor() {
    this.dataDir = path.resolve(__dirname, '../data')
    this.targetFile = path.resolve(__dirname, '../../../../packages/shared/data/preference/preferenceSchemas.ts')
    this.classificationFile = path.join(this.dataDir, 'classification.json')
  }

  generate() {
    console.log('开始生成 preferences.ts...')

    // 读取分类数据
    const classification = this.loadClassification()

    // 提取preferences相关数据
    const preferencesData = this.extractPreferencesData(classification)

    // 构建类型结构
    const typeStructure = this.buildTypeStructure(preferencesData)

    // 生成TypeScript代码
    const content = this.generateTypeScriptCode(typeStructure, preferencesData)

    // 写入文件
    this.writePreferencesFile(content)

    console.log('preferences.ts 生成完成！')
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

    // 递归提取项目，包括children
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
    return deduplicatedData
  }

  buildTypeStructure(preferencesData) {
    const structure = { default: {} }

    preferencesData.forEach((item) => {
      if (!item.targetKey) return

      // 直接使用targetKey作为键，不进行拆分
      structure.default[item.targetKey] = {
        type: this.mapType(item.type, item.defaultValue),
        defaultValue: item.defaultValue,
        description: `${item.source}/${item.sourceCategory}/${item.originalKey}`,
        originalItem: item
      }
    })

    return structure
  }

  mapType(itemType, defaultValue) {
    // 优先使用明确定义的类型，只有当type为unknown时才进行类型推断
    // 'VALUE: null' is a special marker to indicate the value should be null and not overwritten
    const isNullable = defaultValue === null || defaultValue === undefined || defaultValue === 'VALUE: null'

    // 如果type不是unknown，直接使用定义好的类型
    if (itemType && itemType !== 'unknown') {
      // 处理简单的基础类型
      if (itemType === 'boolean') {
        return isNullable ? 'boolean | null' : 'boolean'
      }
      if (itemType === 'string') {
        return isNullable ? 'string | null' : 'string'
      }
      if (itemType === 'number') {
        return isNullable ? 'number | null' : 'number'
      }

      // 处理数组类型（支持string[]、number[]等格式）
      if (itemType.endsWith('[]')) {
        return isNullable ? `${itemType} | null` : itemType
      }

      // 处理array泛型类型
      if (itemType === 'array') {
        // 尝试从默认值推断数组元素类型
        if (Array.isArray(defaultValue) && defaultValue.length > 0) {
          const elementType = typeof defaultValue[0]
          return `${elementType}[]`
        }
        return isNullable ? 'unknown[] | null' : 'unknown[]'
      }

      // 处理object类型
      if (itemType === 'object') {
        return isNullable ? 'Record<string, unknown> | null' : 'Record<string, unknown>'
      }

      // 对于其他明确定义的类型，直接使用
      return isNullable ? `${itemType} | null` : itemType
    }

    // 只有当type为unknown或未定义时，才基于默认值进行类型推断
    if (defaultValue !== null && defaultValue !== undefined) {
      const valueType = typeof defaultValue
      if (valueType === 'boolean' || valueType === 'string' || valueType === 'number') {
        return valueType
      }
      if (Array.isArray(defaultValue)) {
        return 'unknown[]'
      }
      if (valueType === 'object') {
        return 'Record<string, unknown>'
      }
    }

    return 'unknown | null'
  }

  generateTypeScriptCode(structure, preferencesData) {
    const header = `/**
 * Auto-generated preferences configuration
 * Generated at: ${new Date().toISOString()}
 *
 * This file is automatically generated from classification.json
 * To update this file, modify classification.json and run:
 * node v2-refactor-temp/tools/data-classify/scripts/generate-preferences.js
 *
 * ## Key Naming Convention
 *
 * All preference keys MUST follow the format: \`namespace.sub.key_name\`
 *
 * Rules:
 * - At least 2 segments separated by dots (.)
 * - Each segment uses lowercase letters, numbers, and underscores only
 * - Pattern: /^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$/
 *
 * Examples:
 * - 'app.user.avatar' (valid)
 * - 'chat.multi_select_mode' (valid)
 * - 'userAvatar' (invalid - missing dot separator)
 * - 'App.user' (invalid - uppercase not allowed)
 *
 * This convention is enforced by ESLint rule: data-schema-key/valid-key
 *
 * === AUTO-GENERATED CONTENT START ===
 */

import { MEMORY_FACT_EXTRACTION_PROMPT, MEMORY_UPDATE_SYSTEM_PROMPT,TRANSLATE_PROMPT } from '@shared/config/prompts'
import * as PreferenceTypes from '@shared/data/preference/preferenceTypes'

/* eslint @typescript-eslint/member-ordering: ["error", {
  "interfaces": { "order": "alphabetically" },
  "typeLiterals": { "order": "alphabetically" }
}] */`
    // 生成接口定义
    const interfaceCode = this.generateInterface(structure)

    // 生成默认值对象
    const defaultsCode = this.generateDefaults(structure)

    const footer = `
// === AUTO-GENERATED CONTENT END ===

/**
 * 生成统计:
 * - 总配置项: ${preferencesData.length}
 * - electronStore项: ${preferencesData.filter((p) => p.source === 'electronStore').length}
 * - redux项: ${preferencesData.filter((p) => p.source === 'redux').length}
 * - localStorage项: ${preferencesData.filter((p) => p.source === 'localStorage').length}
 */`

    return [header, interfaceCode, defaultsCode, footer].join('\n\n')
  }

  generateInterface(structure, depth = 0) {
    const indent = '  '.repeat(depth)

    if (depth === 0) {
      // 顶层接口
      let code = `export interface PreferenceSchemas {\n`
      Object.keys(structure)
        .sort()
        .forEach((scope) => {
          code += `${indent}  ${scope}: {\n`
          code += this.generateInterfaceProperties(structure[scope], depth + 2)
          code += `${indent}  }\n`
        })
      code += `}`
      return code
    }
  }

  generateInterfaceProperties(obj, depth) {
    const indent = '  '.repeat(depth)
    let code = ''

    // 获取所有键并排序
    const keys = Object.keys(obj).sort()

    keys.forEach((key) => {
      const value = obj[key]

      if (value.type) {
        // 叶子节点 - 实际的配置项，直接使用targetKey
        const comment = value.description ? `${indent}// ${value.description}\n` : ''
        code += `${comment}${indent}'${key}': ${value.type}\n`
      } else {
        // 中间节点 - 嵌套对象
        code += `${indent}'${key}': {\n`
        code += this.generateInterfaceProperties(value, depth + 1)
        code += `${indent}}\n`
      }
    })

    return code
  }

  generateDefaults(structure) {
    const header = `/* eslint sort-keys: ["error", "asc", {"caseSensitive": true, "natural": false}] */
export const DefaultPreferences: PreferenceSchemas = {`

    let code = header + '\n'

    Object.keys(structure)
      .sort()
      .forEach((scope) => {
        code += `  ${scope}: {\n`
        code += this.generateDefaultsProperties(structure[scope], 2)
        code += '  }\n'
      })

    code += '}'
    return code
  }

  generateDefaultsProperties(obj, depth) {
    const indent = '  '.repeat(depth)
    let code = ''

    // 获取所有键并排序
    const keys = Object.keys(obj).sort()

    keys.forEach((key, index) => {
      const value = obj[key]
      const isLast = index === keys.length - 1

      if (value.type) {
        // 叶子节点 - 实际的配置项，直接使用targetKey
        const defaultVal = this.formatDefaultValue(value.defaultValue)
        code += `${indent}'${key}': ${defaultVal}${isLast ? '' : ','}\n`
      } else {
        // 中间节点 - 嵌套对象
        code += `${indent}'${key}': {\n`
        code += this.generateDefaultsProperties(value, depth + 1)
        code += `${indent}}${isLast ? '' : ','}\n`
      }
    })

    return code
  }

  formatDefaultValue(value) {
    if (value === null || value === undefined) {
      return 'null'
    }
    if (typeof value === 'string') {
      // Handle special "VALUE: xxxx" format - use xxxx directly without quotes
      if (value.startsWith('VALUE: ')) {
        return value.substring(7) // Remove "VALUE: " prefix and don't add quotes
      }
      return `'${value.replace(/'/g, "\\'")}'`
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return String(value)
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.formatDefaultValue(item)).join(', ')}]`
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value).map(([k, v]) => `${k}: ${this.formatDefaultValue(v)}`)
      return `{ ${entries.join(', ')} }`
    }
    return JSON.stringify(value)
  }

  writePreferencesFile(content) {
    const targetDir = path.dirname(this.targetFile)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    fs.writeFileSync(this.targetFile, content, 'utf8')
  }

  printSummary(preferencesData) {
    console.log(`\n生成摘要:`)
    console.log(`- 总配置项: ${preferencesData.length}`)
    console.log(`- electronStore项: ${preferencesData.filter((p) => p.source === 'electronStore').length}`)
    console.log(`- redux项: ${preferencesData.filter((p) => p.source === 'redux').length}`)
    console.log(`- localStorage项: ${preferencesData.filter((p) => p.source === 'localStorage').length}`)
    console.log(`- 输出文件: ${this.targetFile}`)

    // 显示一些示例targetKey
    const sampleKeys = preferencesData
      .slice(0, 5)
      .map((p) => p.targetKey)
      .filter(Boolean)
    if (sampleKeys.length > 0) {
      console.log(`\n示例配置键:`)
      sampleKeys.forEach((key) => console.log(`  - ${key}`))
    }
  }
}

// 主执行逻辑
if (require.main === module) {
  try {
    const generator = new PreferencesGenerator()
    generator.generate()
  } catch (error) {
    console.error('生成失败:', error.message)
    process.exit(1)
  }
}

module.exports = PreferencesGenerator
