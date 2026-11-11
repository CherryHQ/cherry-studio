import { LLMock, type ChatCompletionRequest } from '@copilotkit/aimock'

export async function startTranslationSettingsServer() {
  const inputs = [
    '今天阳光明媚，我们一起去公园散步，欣赏美丽的花朵。',
    '明天天气晴朗，我们准备一起去图书馆阅读有趣的书籍。',
    '周末我们计划去博物馆参观，了解这座城市悠久的历史。'
  ]
  const answers = [
    'It is sunny today. Let us walk in the park and enjoy the beautiful flowers.',
    'The weather will be fine tomorrow. We plan to read interesting books at the library.',
    'This weekend we plan to visit the museum and learn about the long history of this city.'
  ]
  const mock = new LLMock({ port: 0, host: '127.0.0.1', strict: true, logLevel: 'silent' })
  for (const [index, input] of inputs.entries()) {
    for (const detection of [true, false]) {
      mock.addFixture({
        match: detection ? { systemMessage: [input, 'precisely identify the language'] } : { userMessage: input },
        response: {
          content: detection ? 'zh-cn' : answers[index],
          usage: detection ? { prompt_tokens: 17, completion_tokens: 3 } : { prompt_tokens: 29, completion_tokens: 11 }
        }
      })
    }
  }
  await mock.start()
  return {
    baseUrl: `${mock.url}/v1`,
    get requests() {
      return mock.journal.getAll().map(({ body }) => body as ChatCompletionRequest)
    },
    inputs,
    answers,
    close: () => mock.stop()
  }
}
