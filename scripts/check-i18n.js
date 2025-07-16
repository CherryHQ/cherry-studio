'use strict'
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        var desc = Object.getOwnPropertyDescriptor(m, k)
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k]
            }
          }
        }
        Object.defineProperty(o, k2, desc)
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        o[k2] = m[k]
      })
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v })
      }
    : function (o, v) {
        o['default'] = v
      })
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = []
          for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k
          return ar
        }
      return ownKeys(o)
    }
    return function (mod) {
      if (mod && mod.__esModule) return mod
      var result = {}
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== 'default') __createBinding(result, mod, k[i])
      __setModuleDefault(result, mod)
      return result
    }
  })()
Object.defineProperty(exports, '__esModule', { value: true })
var fs = __importStar(require('fs'))
var path = __importStar(require('path'))
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
      console.error('\u89E3\u6790 '.concat(file, ' \u51FA\u9519\uFF0C\u8DF3\u8FC7\u6B64\u6587\u4EF6\u3002'), error)
      continue
    }
    var isUpdated = syncRecursively(targetJson, baseJson)
    if (isUpdated) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(targetJson, null, 2) + '\n', 'utf-8')
        console.log('\u6587\u4EF6 '.concat(file, ' \u5DF2\u66F4\u65B0\u540C\u6B65\u4E3B\u6A21\u677F\u7684\u5185\u5BB9'))
      } catch (error) {
        console.error('\u5199\u5165 '.concat(file, ' \u51FA\u9519\u3002').concat(error))
      }
    } else {
      console.log('\u6587\u4EF6 '.concat(file, ' \u65E0\u9700\u66F4\u65B0'))
    }
  }
}
syncTranslations()
