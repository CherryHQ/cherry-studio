/**
 * 使用 OpenAI 兼容的模型生成 i18n 文本，并更新到 translate 目录
 *
 * API_KEY=sk-xxxx BASE_URL=xxxx MODEL=xxxx ts-node scripts/update-i18n.ts
 */

const API_KEY = process.env.API_KEY
const BASE_URL = process.env.BASE_URL || 'https://llmapi.paratera.com/v1'
const MODEL = process.env.MODEL || 'Qwen3-235B-A22B'

const INDEX = [
  // 语言的名称代码用来翻译的模型
  { name: 'France', code: 'fr-fr', model: MODEL },
  { name: 'Spanish', code: 'es-es', model: MODEL },
  { name: 'Portuguese', code: 'pt-pt', model: MODEL },
  { name: 'Greek', code: 'el-gr', model: MODEL }
]

const fs = require('fs')
import OpenAI from 'openai'

const zh = JSON.parse(fs.readFileSync('src/renderer/src/i18n/locales/zh-cn.json', 'utf8')) as object

const openai = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL
})

// 递归遍历翻译
async function translate(zh: object, obj: object, target: string, model: string, updateFile) {
  const texts: { [key: string]: string } = {}
  for (const e in zh) {
    if (typeof zh[e] == 'object') {
      // 遍历下一层
      if (!obj[e] || typeof obj[e] != 'object') obj[e] = {}
      await translate(zh[e], obj[e], target, model, updateFile)
    } else {
      // 加入到本层待翻译列表
      if (!obj[e] || typeof obj[e] != 'string') {
        texts[e] = zh[e]
      }
    }
  }
  if (Object.keys(texts).length > 0) {
    const completion = await openai.chat.completions.create({
      model: model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: `
You are a robot specifically designed for translation tasks. As a model that has been extensively fine-tuned on Russian language corpora, you are proficient in using the Russian language.
Now, please output the translation based on the input content. The input will include both Chinese and English key values, and you should output the corresponding key values in the Russian language.
When translating, ensure that no key value is omitted, and maintain the accuracy and fluency of the translation. Pay attention to the capitalization rules in the output to match the source text, and especially pay attention to whether to capitalize the first letter of each word except for prepositions. For strings containing \`{{value}}\`, ensure that the format is not disrupted.
Output in JSON.
######################################################
INPUT
######################################################
${JSON.stringify({
  confirm: '确定要备份数据吗？',
  select_model: '选择模型',
  title: '文件',
  deeply_thought: '已深度思考（用时 {{secounds}} 秒）'
})}
######################################################
MAKE SURE TO OUTPUT IN Russian. DO NOT OUTPUT IN UNSPECIFIED LANGUAGE.
######################################################
                `
        },
        {
          role: 'assistant',
          content: JSON.stringify({
            confirm: 'Подтвердите резервное копирование данных?',
            select_model: 'Выберите Модель',
            title: 'Файл',
            deeply_thought: 'Глубоко продумано (заняло {{seconds}} секунд)'
          })
        },
        {
          role: 'user',
          content: `
You are a robot specifically designed for translation tasks. As a model that has been extensively fine-tuned on ${target} language corpora, you are proficient in using the ${target} language.
Now, please output the translation based on the input content. The input will include both Chinese and English key values, and you should output the corresponding key values in the ${target} language.
When translating, ensure that no key value is omitted, and maintain the accuracy and fluency of the translation. Pay attention to the capitalization rules in the output to match the source text, and especially pay attention to whether to capitalize the first letter of each word except for prepositions. For strings containing \`{{value}}\`, ensure that the format is not disrupted.
Output in JSON.
######################################################
INPUT
######################################################
${JSON.stringify(texts)}
######################################################
MAKE SURE TO OUTPUT IN ${target}. DO NOT OUTPUT IN UNSPECIFIED LANGUAGE.
######################################################
                `
        }
      ]
    })
    // 添加翻译后的键值，并打印错译漏译内容
    try {
      const result = JSON.parse(completion.choices[0].message.content!)
      for (const e in texts) {
        if (result[e] && typeof result[e] === 'string') {
          obj[e] = result[e]
        } else {
          console.log('[warning]', `missing value "${e}" in ${target} translation`)
        }
      }
    } catch (e) {
      console.log('[error]', e)
      for (const e in texts) {
        console.log('[warning]', `missing value "${e}" in ${target} translation`)
      }
    }
  }
  // 删除多余的键值
  for (const e in obj) {
    if (!zh[e]) {
      delete obj[e]
    }
  }
  // 更新文件
  updateFile()
}

;(async () => {
  for (const { name, code, model } of INDEX) {
    const obj = fs.existsSync(`src/renderer/src/i18n/translate/${code}.json`)
      ? JSON.parse(fs.readFileSync(`src/renderer/src/i18n/translate/${code}.json`, 'utf8'))
      : {}
    await translate(zh, obj, name, model, () => {
      fs.writeFileSync(`src/renderer/src/i18n/translate/${code}.json`, JSON.stringify(obj, null, 2), 'utf8')
    })
  }
})()
