'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.main = main
var fs = require('fs')
var path = require('path')
var sort_1 = require('./sort')
var translationsDir = path.join(__dirname, '../src/renderer/src/i18n/locales')
var baseLocale = 'zh-cn'
var baseFileName = ''.concat(baseLocale, '.json')
var baseFilePath = path.join(translationsDir, baseFileName)
/**
 * 递归检查并同步目标对象与模板对象的键值结构
 * 1. 如果目标对象缺少模板对象中的键，抛出错误
 * 2. 如果目标对象存在模板对象中不存在的键，抛出错误
 * 3. 对于嵌套对象，递归执行同步操作
 *
 * 该函数用于确保所有翻译文件与基准模板（通常是中文翻译文件）保持完全一致的键值结构。
 * 任何结构上的差异都会导致错误被抛出，以便及时发现和修复翻译文件中的问题。
 *
 * @param target 需要检查的目标翻译对象
 * @param template 作为基准的模板对象（通常是中文翻译文件）
 * @throws {Error} 当发现键值结构不匹配时抛出错误
 */
function checkRecursively(target, template) {
  for (var key in template) {
    if (!(key in target)) {
      throw new Error('\u7F3A\u5C11\u5C5E\u6027 '.concat(key))
    }
    if (typeof template[key] === 'object' && template[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        throw new Error('\u5C5E\u6027 '.concat(key, ' \u4E0D\u662F\u5BF9\u8C61'))
      }
      // 递归检查子对象
      checkRecursively(target[key], template[key])
    }
  }
  // 删除 target 中存在但 template 中没有的 key
  for (var targetKey in target) {
    if (!(targetKey in template)) {
      throw new Error('\u591A\u4F59\u5C5E\u6027 '.concat(targetKey))
    }
  }
}
function isSortedI18N(obj) {
  // fs.writeFileSync('./test_origin.json', JSON.stringify(obj))
  // fs.writeFileSync('./test_sorted.json', JSON.stringify(sortedObjectByKeys(obj)))
  return JSON.stringify(obj) === JSON.stringify((0, sort_1.sortedObjectByKeys)(obj))
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
function checkTranslations() {
  if (!fs.existsSync(baseFilePath)) {
    throw new Error(
      '\u4E3B\u6A21\u677F\u6587\u4EF6 '.concat(
        baseFileName,
        ' \u4E0D\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6216\u6587\u4EF6\u540D'
      )
    )
  }
  var baseContent = fs.readFileSync(baseFilePath, 'utf-8')
  var baseJson = {}
  try {
    baseJson = JSON.parse(baseContent)
  } catch (error) {
    throw new Error('\u89E3\u6790 '.concat(baseFileName, ' \u51FA\u9519\u3002').concat(error))
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
  // 检查主模板是否有序
  if (!isSortedI18N(baseJson)) {
    throw new Error(
      '\u4E3B\u6A21\u677F\u6587\u4EF6 '.concat(
        baseFileName,
        ' \u7684\u952E\u503C\u672A\u6309\u5B57\u5178\u5E8F\u6392\u5E8F\u3002'
      )
    )
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
      throw new Error('\u89E3\u6790 '.concat(file, ' \u51FA\u9519\u3002'))
    }
    // 检查有序性
    if (!isSortedI18N(targetJson)) {
      throw new Error(
        '\u7FFB\u8BD1\u6587\u4EF6 '.concat(file, ' \u7684\u952E\u503C\u672A\u6309\u5B57\u5178\u5E8F\u6392\u5E8F\u3002')
      )
    }
    try {
      checkRecursively(targetJson, baseJson)
    } catch (e) {
      throw new Error('\u5728\u68C0\u67E5 '.concat(filePath, ' \u65F6\u51FA\u9519\uFF1A').concat(e))
    }
  }
}
function main() {
  try {
    checkTranslations()
  } catch (e) {
    console.error(e)
    throw new Error(
      '\u68C0\u67E5\u672A\u901A\u8FC7\u3002\u5C1D\u8BD5\u8FD0\u884C yarn sync:i18n \u4EE5\u89E3\u51B3\u95EE\u9898\u3002'
    )
  }
}
main()
