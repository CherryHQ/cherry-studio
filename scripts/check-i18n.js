'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
var fs = require('fs')
var path = require('path')
var translationsDir = path.join(__dirname, '../src/renderer/src/i18n/locales')
var baseLocale = 'zh-CN'
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
  var isUpdated = false
  // 添加 template 中存在但 target 中缺少的 key
  for (var key in template) {
    if (!(key in target)) {
      target[key] =
        typeof template[key] === 'object' && template[key] !== null ? {} : '[to be translated]:'.concat(template[key])
      console.log('\u6DFB\u52A0\u65B0\u5C5E\u6027\uFF1A'.concat(key))
      isUpdated = true
    }
    if (typeof template[key] === 'object' && template[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {}
        isUpdated = true
      }
      // 递归同步子对象
      var childUpdated = syncRecursively(target[key], template[key])
      if (childUpdated) {
        isUpdated = true
      }
    }
  }
  // 删除 target 中存在但 template 中没有的 key
  for (var targetKey in target) {
    if (!(targetKey in template)) {
      console.log('\u79FB\u9664\u591A\u4F59\u5C5E\u6027\uFF1A'.concat(targetKey))
      delete target[targetKey]
      isUpdated = true
    }
  }
  return isUpdated
}
function syncTranslations() {
  if (!fs.existsSync(baseFilePath)) {
    console.error(
      '\u4E3B\u6A21\u677F\u6587\u4EF6 '.concat(
        baseFileName,
        ' \u4E0D\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6216\u6587\u4EF6\u540D\u3002'
      )
    )
    return
  }
  var baseContent = fs.readFileSync(baseFilePath, 'utf-8')
  var baseJson = {}
  try {
    baseJson = JSON.parse(baseContent)
  } catch (error) {
    console.error('\u89E3\u6790 '.concat(baseFileName, ' \u51FA\u9519:'), error)
    return
  }
  var files = fs.readdirSync(translationsDir).filter(function (file) {
    return file.endsWith('.json') && file !== baseFileName
  })
  for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
    var file = files_1[_i]
    var filePath = path.join(translationsDir, file)
    var targetJson = {}
    try {
      var fileContent = fs.readFileSync(filePath, 'utf-8')
      targetJson = JSON.parse(fileContent)
    } catch (error) {
      console.error(
        '\u89E3\u6790 '.concat(
          file,
          ' \u51FA\u9519\uFF0C\u8DF3\u8FC7\u6B64\u6587\u4EF6\u3002\u9519\u8BEF\u4FE1\u606F:'
        ),
        error
      )
      continue
    }
    var isUpdated = syncRecursively(targetJson, baseJson)
    if (isUpdated) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(targetJson, null, 2), 'utf-8')
        console.log(
          '\u6587\u4EF6 '.concat(file, ' \u5DF2\u66F4\u65B0\u540C\u6B65\u4E3B\u6A21\u677F\u7684\u5185\u5BB9\u3002')
        )
      } catch (error) {
        console.error('\u5199\u5165 '.concat(file, ' \u51FA\u9519:'), error)
      }
    } else {
      console.log('\u6587\u4EF6 '.concat(file, ' \u65E0\u9700\u66F4\u65B0\u3002'))
    }
  }
}
syncTranslations()
