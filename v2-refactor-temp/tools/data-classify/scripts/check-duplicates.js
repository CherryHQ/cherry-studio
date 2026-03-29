#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

function checkDuplicatesAndChildren() {
  const classificationFile = path.join(__dirname, '../data/classification.json')
  const classification = JSON.parse(fs.readFileSync(classificationFile, 'utf8'))

  // 提取所有preferences项（包括children）
  const allPrefs = []

  function extractItems(items, source, category, parentKey = '') {
    if (!Array.isArray(items)) return

    items.forEach((item) => {
      // 处理有children的项目
      if (item.children) {
        console.log(`发现children项: ${source}/${category}/${item.originalKey}`)
        extractItems(item.children, source, category, `${parentKey}${item.originalKey}.`)
        return
      }

      // 处理普通项目
      if (item.category === 'preferences' && item.status === 'classified' && item.targetKey) {
        allPrefs.push({
          source,
          category,
          originalKey: parentKey + item.originalKey,
          targetKey: item.targetKey,
          fullPath: `${source}/${category}/${parentKey}${item.originalKey}`
        })
      }
    })
  }
  // 遍历所有数据源
  ;['electronStore', 'redux', 'localStorage'].forEach((source) => {
    if (classification.classifications[source]) {
      Object.keys(classification.classifications[source]).forEach((category) => {
        const items = classification.classifications[source][category]
        extractItems(items, source, category)
      })
    }
  })

  console.log(`\n=== 总共找到 ${allPrefs.length} 个preferences项 ===\n`)

  // 检查重复的targetKey
  const targetKeyGroups = {}
  allPrefs.forEach((pref) => {
    if (!targetKeyGroups[pref.targetKey]) {
      targetKeyGroups[pref.targetKey] = []
    }
    targetKeyGroups[pref.targetKey].push(pref)
  })

  // 显示重复项
  const duplicates = Object.keys(targetKeyGroups).filter((key) => targetKeyGroups[key].length > 1)
  if (duplicates.length > 0) {
    console.log('=== 重复的targetKey ===')
    duplicates.forEach((targetKey) => {
      console.log(`\n${targetKey}:`)
      targetKeyGroups[targetKey].forEach((pref) => {
        console.log(`  - ${pref.fullPath}`)
      })
    })
  } else {
    console.log('✅ 没有发现重复的targetKey')
  }

  return { allPrefs, duplicates: duplicates.map((key) => targetKeyGroups[key]) }
}

if (require.main === module) {
  checkDuplicatesAndChildren()
}

module.exports = checkDuplicatesAndChildren
