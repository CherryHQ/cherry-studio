import { describe, expect, test } from 'vitest'

import { TagConfig, TagExtractor } from '../tagExtraction'

describe('TagExtractor', () => {
  describe('基本标签提取', () => {
    test('应该正确提取简单的标签内容', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('<think>Hello World</think>')

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        content: 'Hello World',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: 'Hello World'
      })
    })

    test('应该处理标签前后的普通文本', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('前文<think>思考内容</think>后文')

      expect(results).toHaveLength(4)
      expect(results[0]).toEqual({
        content: '前文',
        isTagContent: false,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '思考内容',
        isTagContent: true,
        complete: false
      })
      expect(results[2]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '思考内容'
      })
      expect(results[3]).toEqual({
        content: '后文',
        isTagContent: false,
        complete: false
      })
    })

    test('应该处理空标签', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('<think></think>')

      expect(results).toHaveLength(0)
    })
  })

  describe('分块处理', () => {
    test('应该正确处理分块的标签内容', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      let results = extractor.processText('<think>第一')
      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        content: '第一',
        isTagContent: true,
        complete: false
      })

      results = extractor.processText('部分内容')
      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        content: '部分内容',
        isTagContent: true,
        complete: false
      })

      results = extractor.processText('</think>')
      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第一部分内容'
      })
    })

    test('应该处理分块的开始标签', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      let results = extractor.processText('<thi')
      expect(results).toHaveLength(0)

      results = extractor.processText('nk>内容</think>')
      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        content: '内容',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '内容'
      })
    })

    test('应该处理模拟可读流的分块数据', async () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      // 模拟流式数据块
      const streamChunks = [
        '这是普通文本',
        '<thi',
        'nk>这是第一个',
        '思考内容',
        '</think>',
        '中间的一些文本',
        '<think>第二',
        '个思考内容',
        '</thi',
        'nk>',
        '结束文本'
      ]

      const allResults: any[] = []

      // 模拟异步流式处理
      for (const chunk of streamChunks) {
        await new Promise((resolve) => setTimeout(resolve, 10)) // 模拟异步延迟
        const results = extractor.processText(chunk)
        allResults.push(...results)
      }

      // 验证结果
      expect(allResults).toHaveLength(9)

      // 第一个普通文本
      expect(allResults[0]).toEqual({
        content: '这是普通文本',
        isTagContent: false,
        complete: false
      })

      // 第一个思考标签内容
      expect(allResults[1]).toEqual({
        content: '这是第一个',
        isTagContent: true,
        complete: false
      })

      expect(allResults[2]).toEqual({
        content: '思考内容',
        isTagContent: true,
        complete: false
      })

      // 第一个完整的标签内容提取
      expect(allResults[3]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '这是第一个思考内容'
      })

      // 中间文本
      expect(allResults[4]).toEqual({
        content: '中间的一些文本',
        isTagContent: false,
        complete: false
      })

      // 第二个思考标签内容
      expect(allResults[5]).toEqual({
        content: '第二',
        isTagContent: true,
        complete: false
      })

      // 第二个完整的标签内容提取和结束文本
      expect(allResults[6]).toEqual({
        content: '个思考内容',
        isTagContent: true,
        complete: false
      })

      expect(allResults[7]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第二个思考内容'
      })

      expect(allResults[8]).toEqual({
        content: '结束文本',
        isTagContent: false,
        complete: false
      })
    })
  })

  describe('多个标签处理', () => {
    test('应该处理连续的多个标签', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('<think>第一个</think><think>第二个</think>')

      expect(results).toHaveLength(4)
      expect(results[0]).toEqual({
        content: '第一个',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第一个'
      })
      expect(results[2]).toEqual({
        content: '第二个',
        isTagContent: true,
        complete: false
      })
      expect(results[3]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第二个'
      })
    })

    test('应该处理标签间的文本内容', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('<think>思考1</think>中间文本<think>思考2</think>')

      expect(results).toHaveLength(5)
      expect(results[0]).toEqual({
        content: '思考1',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '思考1'
      })
      expect(results[2]).toEqual({
        content: '中间文本',
        isTagContent: false,
        complete: false
      })
      expect(results[3]).toEqual({
        content: '思考2',
        isTagContent: true,
        complete: false
      })
      expect(results[4]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '思考2'
      })
    })

    test('应该处理三个连续标签的分次输出', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      // 第一次输入：包含两个完整标签和第三个标签的开始
      let results = extractor.processText('<think>第一个</think><think>第二个</think><think>第三个开始')

      expect(results).toHaveLength(5)
      expect(results[0]).toEqual({
        content: '第一个',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第一个'
      })
      expect(results[2]).toEqual({
        content: '第二个',
        isTagContent: true,
        complete: false
      })
      expect(results[3]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第二个'
      })
      expect(results[4]).toEqual({
        content: '第三个开始',
        isTagContent: true,
        complete: false
      })

      // 第二次输入：继续第三个标签的内容
      results = extractor.processText('继续内容')

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        content: '继续内容',
        isTagContent: true,
        complete: false
      })

      // 第三次输入：完成第三个标签
      results = extractor.processText('结束</think>')

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        content: '结束',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第三个开始继续内容结束'
      })
    })

    test('应该处理三个连续标签的另一种分次输出模式', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      // 第一次输入：第一个完整标签
      let results = extractor.processText('<think>第一个思考</think>')

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        content: '第一个思考',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第一个思考'
      })

      // 第二次输入：第二个完整标签和第三个标签的部分内容
      results = extractor.processText('<think>第二个思考</think><think>第三个开')

      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({
        content: '第二个思考',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第二个思考'
      })
      expect(results[2]).toEqual({
        content: '第三个开',
        isTagContent: true,
        complete: false
      })

      // 第三次输入：完成第三个标签
      results = extractor.processText('始部分</think>')

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        content: '始部分',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '第三个开始部分'
      })
    })
  })

  describe('不完整标签处理', () => {
    test('应该处理只有开始标签的情况', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('<think>未完成的思考')

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        content: '未完成的思考',
        isTagContent: true,
        complete: false
      })
    })

    test('应该处理文本中间截断的标签', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('正常文本<thi')

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        content: '正常文本',
        isTagContent: false,
        complete: false
      })
    })
  })

  describe('finalize 方法', () => {
    test('应该返回未完成的标签内容', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      extractor.processText('<think>未完成的内容')
      const result = extractor.finalize()

      expect(result).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '未完成的内容'
      })
    })

    test('当没有未完成内容时应该返回 null', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      extractor.processText('<think>完整内容</think>')
      const result = extractor.finalize()

      expect(result).toBeNull()
    })

    test('对于普通文本应该返回 null', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      extractor.processText('只是普通文本')
      const result = extractor.finalize()

      expect(result).toBeNull()
    })
  })

  describe('reset 方法', () => {
    test('应该重置所有内部状态', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      // 处理一些文本以改变内部状态
      extractor.processText('<think>一些内容')

      // 重置
      extractor.reset()

      // 重置后应该能正常处理新的文本
      const results = extractor.processText('<think>新内容</think>')

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        content: '新内容',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '新内容'
      })
    })

    test('重置后 finalize 应该返回 null', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      extractor.processText('<think>未完成')
      extractor.reset()

      const result = extractor.finalize()
      expect(result).toBeNull()
    })
  })

  describe('不同标签配置', () => {
    test('应该处理工具使用标签', () => {
      const config: TagConfig = {
        openingTag: '<tool_use>',
        closingTag: '</tool_use>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('<tool_use>{"name": "search"}</tool_use>')

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        content: '{"name": "search"}',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '{"name": "search"}'
      })
    })

    test('应该处理自定义标签', () => {
      const config: TagConfig = {
        openingTag: '[START]',
        closingTag: '[END]'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('前文[START]中间内容[END]后文')

      expect(results).toHaveLength(4)
      expect(results[0]).toEqual({
        content: '前文',
        isTagContent: false,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '中间内容',
        isTagContent: true,
        complete: false
      })
      expect(results[2]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '中间内容'
      })
      expect(results[3]).toEqual({
        content: '后文',
        isTagContent: false,
        complete: false
      })
    })
  })

  describe('边界情况', () => {
    test('应该处理空字符串输入', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('')

      expect(results).toHaveLength(0)
    })

    test('应该处理只包含标签的输入', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('<think></think>')

      expect(results).toHaveLength(0)
    })

    test('应该处理标签内容包含相似文本的情况', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const results = extractor.processText('<think>我在<thinking>思考</think>')

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        content: '我在<thinking>思考',
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: '我在<thinking>思考'
      })
    })

    test('应该处理换行符和特殊字符', () => {
      const config: TagConfig = {
        openingTag: '<think>',
        closingTag: '</think>'
      }
      const extractor = new TagExtractor(config)

      const content = '多行\n内容\t带制表符'
      const results = extractor.processText(`<think>${content}</think>`)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        content: content,
        isTagContent: true,
        complete: false
      })
      expect(results[1]).toEqual({
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: content
      })
    })
  })
})
