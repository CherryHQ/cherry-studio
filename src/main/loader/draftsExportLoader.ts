import * as fs from 'node:fs'

import { JsonLoader } from '@llm-tools/embedjs'

/**
 * Drafts 应用导出的笔记文件加载器
 * 原始文件是一个 JSON 数组。每条笔记只保留 content、tags、modified_at 三个字段
 */
export class DraftsExportLoader extends JsonLoader {
  constructor(filePath: string) {
    const fileContent = fs.readFileSync(filePath, 'utf-8')
    const rawJson = JSON.parse(fileContent) as any[]
    const json = rawJson.map((item) => {
      return {
        content: item.content?.replace(/\n/g, '<br>'),
        tags: item.tags,
        modified_at: item.created_at
      }
    })
    super({ object: json })
  }
}
