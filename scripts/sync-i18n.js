'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
var fs = require('fs')
var path = require('path')
var sort_1 = require('./sort')
var translationsDir = path.join(__dirname, '../src/renderer/src/i18n/locales')
var baseLocale = 'zh-cn'
var baseFileName = ''.concat(baseLocale, '.json')
var baseFilePath = path.join(translationsDir, baseFileName)
/**
 * 递归同步 target 对象，使其与 template 对象保持一致
 * 1. 如果 template 中存在 target 中缺少的 key，则添加（'[to be translated]'）
 * 2. 如果 target 中存在 template 中不存在的 key，则删除
 * 3. 对于子对象，递归同步
 *
 * @param target 目标对象（需要更新的语言对象）
 * @param template 主模板对象（中文）
 * @returns 返回是否对 target 进行了更新
 */
function syncRecursively(target, template) {
  // 添加 template 中存在但 target 中缺少的 key
  for (var key in template) {
    if (!(key in target)) {
      target[key] =
        typeof template[key] === 'object' && template[key] !== null ? {} : '[to be translated]:'.concat(template[key])
      console.log('\u6DFB\u52A0\u65B0\u5C5E\u6027\uFF1A'.concat(key))
    }
    if (typeof template[key] === 'object' && template[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {}
      }
      // 递归同步子对象
      syncRecursively(target[key], template[key])
    }
  }
  // 删除 target 中存在但 template 中没有的 key
  for (var targetKey in target) {
    if (!(targetKey in template)) {
      console.log('\u79FB\u9664\u591A\u4F59\u5C5E\u6027\uFF1A'.concat(targetKey))
      delete target[targetKey]
    }
  }
}
/**
 * 检查 JSON 对象中是否存在重复键，并收集所有重复键
 * @param obj 要检查的对象
 * @returns 返回重复键的数组（若无重复则返回空数组）
 */
function checkDuplicateKeys(obj) {
  var keys = new Set()
  var duplicateKeys = []
  var checkObject = function (obj, path) {
    if (path === void 0) {
      path = ''
    }
    for (var key in obj) {
      var fullPath = path ? ''.concat(path, '.').concat(key) : key
      if (keys.has(fullPath)) {
        // 发现重复键时，添加到数组中（避免重复添加）
        if (!duplicateKeys.includes(fullPath)) {
          duplicateKeys.push(fullPath)
        }
      } else {
        keys.add(fullPath)
      }
      // 递归检查子对象
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        checkObject(obj[key], fullPath)
      }
    }
  }
  checkObject(obj)
  return duplicateKeys
}
function syncTranslations() {
  if (!fs.existsSync(baseFilePath)) {
    console.error(
      '\u4E3B\u6A21\u677F\u6587\u4EF6 '.concat(
        baseFileName,
        ' \u4E0D\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6216\u6587\u4EF6\u540D'
      )
    )
    return
  }
  var baseContent = fs.readFileSync(baseFilePath, 'utf-8')
  var baseJson = {}
  try {
    baseJson = JSON.parse(baseContent)
  } catch (error) {
    console.error('\u89E3\u6790 '.concat(baseFileName, ' \u51FA\u9519\u3002').concat(error))
    return
  }
  // 检查主模板是否存在重复键
  var duplicateKeys = checkDuplicateKeys(baseJson)
  if (duplicateKeys.length > 0) {
    throw new Error(
      '\u4E3B\u6A21\u677F\u6587\u4EF6 '
        .concat(baseFileName, ' \u5B58\u5728\u4EE5\u4E0B\u91CD\u590D\u952E\uFF1A\n')
        .concat(duplicateKeys.join('\n'))
    )
  }
  // 为主模板排序
  var sortedJson = (0, sort_1.sortedObjectByKeys)(baseJson)
  if (JSON.stringify(baseJson) !== JSON.stringify(sortedJson)) {
    try {
      fs.writeFileSync(baseFilePath, JSON.stringify(sortedJson, null, 2) + '\n', 'utf-8')
      console.log('\u4E3B\u6A21\u677F\u5DF2\u6392\u5E8F')
    } catch (error) {
      console.error('\u5199\u5165 '.concat(baseFilePath, ' \u51FA\u9519\u3002'), error)
      return
    }
  }
  var files = fs.readdirSync(translationsDir).filter(function (file) {
    return file.endsWith('.json') && file !== baseFileName
  })
  // 同步键
  for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
    var file = files_1[_i]
    var filePath = path.join(translationsDir, file)
    var targetJson = {}
    try {
      var fileContent = fs.readFileSync(filePath, 'utf-8')
      targetJson = JSON.parse(fileContent)
    } catch (error) {
      console.error('\u89E3\u6790 '.concat(file, ' \u51FA\u9519\uFF0C\u8DF3\u8FC7\u6B64\u6587\u4EF6\u3002'), error)
      continue
    }
    syncRecursively(targetJson, baseJson)
    var sortedJson_1 = (0, sort_1.sortedObjectByKeys)(targetJson)
    try {
      fs.writeFileSync(filePath, JSON.stringify(sortedJson_1, null, 2) + '\n', 'utf-8')
      console.log(
        '\u6587\u4EF6 '.concat(
          file,
          ' \u5DF2\u6392\u5E8F\u5E76\u540C\u6B65\u66F4\u65B0\u4E3A\u4E3B\u6A21\u677F\u7684\u5185\u5BB9'
        )
      )
    } catch (error) {
      console.error('\u5199\u5165 '.concat(file, ' \u51FA\u9519\u3002').concat(error))
    }
  }
}
syncTranslations()
