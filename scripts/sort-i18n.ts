import * as fs from 'fs'
import * as path from 'path'

import { sortedObjectByKeys } from './sort'

const translationsDir = path.join(__dirname, '../src/renderer/src/i18n/locales')

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

export function main() {
  const files = fs.readdirSync(translationsDir).filter((file) => file.endsWith('.json'))
  for (const file of files) {
    const filePath = path.join(translationsDir, file)
    let targetJson: I18N = {}
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8')
      targetJson = JSON.parse(fileContent)
    } catch (error) {
      console.error(`解析 ${file} 出错，跳过此文件。`, error)
      continue
    }

    const sortedJson = sortedObjectByKeys(targetJson)

    if (JSON.stringify(targetJson) !== JSON.stringify(sortedJson)) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(sortedJson, null, 2) + '\n', 'utf-8')
        console.log(`文件 ${file} 已按键排序`)
      } catch (error) {
        console.error(`写入 ${file} 出错。${error}`)
      }
    } else {
      console.log(`文件 ${file} 无需更新`)
    }
  }
}

main()
