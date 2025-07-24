/**
 * 使用 OpenAI 兼容的模型生成 i18n 文本，并更新到 translate 目录
 *
 * API_KEY=sk-xxxx BASE_URL=xxxx MODEL=xxxx ts-node scripts/update-i18n.ts
 */

import cliProgress from 'cli-progress'
import fs from 'fs'
import OpenAI from 'openai'

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

const API_KEY = process.env.API_KEY
const BASE_URL = process.env.BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1/'
const MODEL = process.env.MODEL || 'qwen-plus-latest'

const INDEX = [
  // 语言的名称代码用来翻译的模型
  { name: 'France', code: 'fr-fr', model: MODEL },
  { name: 'Spanish', code: 'es-es', model: MODEL },
  { name: 'Portuguese', code: 'pt-pt', model: MODEL },
  { name: 'Greek', code: 'el-gr', model: MODEL }
]

const zh = JSON.parse(fs.readFileSync('src/renderer/src/i18n/locales/zh-cn.json', 'utf8')) as I18N

const openai = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL
})

// 递归遍历翻译
async function translate(baseObj: I18N, targetObj: I18N, targetLang: string, model: string, updateFile) {
  const toTranslateTexts: { [key: string]: string } = {}
  for (const key in baseObj) {
    if (typeof baseObj[key] == 'object') {
      // 遍历下一层
      if (!targetObj[key] || typeof targetObj[key] != 'object') targetObj[key] = {}
      await translate(baseObj[key], targetObj[key], targetLang, model, updateFile)
    } else if (
      !targetObj[key] ||
      typeof targetObj[key] != 'string' ||
      (typeof targetObj[key] === 'string' && targetObj[key].startsWith('[to be translated]'))
    ) {
      // 加入到本层待翻译列表
      toTranslateTexts[key] = baseObj[key]
    }
  }
  if (Object.keys(toTranslateTexts).length > 0) {
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
You are a robot specifically designed for translation tasks. As a model that has been extensively fine-tuned on ${targetLang} language corpora, you are proficient in using the ${targetLang} language.
Now, please output the translation based on the input content. The input will include both Chinese and English key values, and you should output the corresponding key values in the ${targetLang} language.
When translating, ensure that no key value is omitted, and maintain the accuracy and fluency of the translation. Pay attention to the capitalization rules in the output to match the source text, and especially pay attention to whether to capitalize the first letter of each word except for prepositions. For strings containing \`{{value}}\`, ensure that the format is not disrupted.
Output in JSON.
######################################################
INPUT
######################################################
${JSON.stringify(toTranslateTexts)}
######################################################
MAKE SURE TO OUTPUT IN ${targetLang}. DO NOT OUTPUT IN UNSPECIFIED LANGUAGE.
######################################################
                `
        }
      ]
    })
    // 添加翻译后的键值，并打印错译漏译内容
    try {
      const result = JSON.parse(completion.choices[0].message.content!)
      // console.debug('result', result)
      for (const e in toTranslateTexts) {
        if (result[e] && typeof result[e] === 'string') {
          targetObj[e] = result[e]
        } else {
          console.warn(`missing value "${e}" in ${targetLang} translation`)
        }
      }
    } catch (e) {
      console.error(e)
      for (const e in toTranslateTexts) {
        console.warn(`missing value "${e}" in ${targetLang} translation`)
      }
    }
  }
  // 删除多余的键值
  for (const e in targetObj) {
    if (!baseObj[e]) {
      delete targetObj[e]
    }
  }
  // 更新文件
  updateFile()
}

let count = 0

;(async () => {
  const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)
  bar.start(INDEX.length, 0)
  for (const { name, code, model } of INDEX) {
    const obj = fs.existsSync(`src/renderer/src/i18n/translate/${code}.json`)
      ? (JSON.parse(fs.readFileSync(`src/renderer/src/i18n/translate/${code}.json`, 'utf8')) as I18N)
      : {}
    await translate(zh, obj, name, model, () => {
      fs.writeFileSync(`src/renderer/src/i18n/translate/${code}.json`, JSON.stringify(obj, null, 2), 'utf8')
    })
    count += 1
    bar.update(count)
  }
  bar.stop()
})()
