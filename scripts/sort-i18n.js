'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
var fs = require('fs')
var path = require('path')
var sort_1 = require('./sort')
var translationsDir = path.join(__dirname, '../src/renderer/src/i18n/locales')
function main() {
  var files = fs.readdirSync(translationsDir).filter(function (file) {
    return file.endsWith('.json')
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
    var sortedJson = (0, sort_1.sortedObjectByKeys)(targetJson)
    if (JSON.stringify(targetJson) !== JSON.stringify(sortedJson)) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(targetJson, null, 2) + '\n', 'utf-8')
        console.log('\u6587\u4EF6 '.concat(file, ' \u5DF2\u6309\u952E\u6392\u5E8F'))
      } catch (error) {
        console.error('\u5199\u5165 '.concat(file, ' \u51FA\u9519\u3002').concat(error))
      }
    } else {
      console.log('\u6587\u4EF6 '.concat(file, ' \u65E0\u9700\u66F4\u65B0'))
    }
  }
}
main()
