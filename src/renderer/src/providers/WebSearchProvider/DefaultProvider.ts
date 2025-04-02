import axios from 'axios'; // 需要导入 axios
import { WebSearchProvider, WebSearchResponse, WebSearchResult } from '@renderer/types';
import BaseWebSearchProvider from './BaseWebSearchProvider';

export default class DefaultProvider extends BaseWebSearchProvider {
  // 实现 search 方法
  async search(query: string, maxResult: number = 5): Promise<WebSearchResponse> {
    // 从受保护的属性中获取 API Host 和 Key
    const apiHost = this.apiHost; // 使用 this.apiHost
    const apiKey = this.apiKey; // 使用 this.apiKey

    if (!apiHost || !apiKey) {
      console.error('DefaultProvider: Missing apiHost or apiKey in provider configuration.');
      return { results: [] }; // 返回空结果表示失败
    }

    // 构建 OpenAI 兼容的聊天请求体
    const requestBody = {
      model: 'gemini-2.5-pro-exp-03-25', // 使用指定的模型
      messages: [
        { role: 'user', content: query } // 将搜索查询作为用户消息
      ],
      tools: [ // 启用 google_search 工具
        {
          type: 'function',
          function: {
            name: 'google_search',
            description: 'Performs a Google search', // 描述可以简单些
            parameters: { type: 'object', properties: {} } // 通常为空，模型自行生成查询
          }
        }
        // 注意：某些兼容层可能期望不同的格式，例如直接 { google_search: {} }
        // 如果下面的请求失败，可能需要调整这里的工具定义格式
      ],
      tool_choice: 'auto', // 让模型决定是否使用工具
      max_tokens: 150 // 限制响应长度，因为我们只关心元数据
      // 可以根据需要添加 temperature 等其他参数
    };

    try {
      const response = await axios.post(
        `${apiHost}/chat/completions`, // 假设是标准的 chat completions 端点
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}` // 使用 Bearer Token 认证
          },
          timeout: 15000 // 设置超时，例如 15 秒
        }
      );

      // --- 解析响应 ---
      // 检查响应中是否包含搜索结果元数据
      // 注意：字段名可能因 OpenAI 兼容层的实现而异，以下是一些常见的可能性
      const groundingMetadata = response.data?.choices?.[0]?.message?.metadata?.groundingMetadata || // Vertex AI 风格
                                response.data?.choices?.[0]?.grounding_metadata || // 另一种可能
                                response.data?.choices?.[0]?.message?.metadata?.retrievedReferences || // 又一种可能
                                response.data?.choices?.[0]?.retrieved_references; // 再一种可能

      let searchResults: WebSearchResult[] = [];

      if (groundingMetadata?.retrievedReferences && Array.isArray(groundingMetadata.retrievedReferences)) {
         // 优先处理 retrievedReferences 结构
         searchResults = groundingMetadata.retrievedReferences
           .slice(0, maxResult) // 限制结果数量
           .map((ref: any) => ({
             title: ref.title || 'No Title',
             url: ref.uri || ref.url || '#', // 尝试不同的 URL 字段名
             snippet: ref.content || ref.text || ref.snippet || 'No Snippet' // 尝试不同的摘要字段名
           }));
      } else if (groundingMetadata?.web_search_results && Array.isArray(groundingMetadata.web_search_results)) {
         // 备选：处理 web_search_results 结构
         searchResults = groundingMetadata.web_search_results
           .slice(0, maxResult)
           .map((res: any) => ({
             title: res.title || 'No Title',
             url: res.link || res.url || '#',
             snippet: res.snippet || res.description || 'No Snippet'
           }));
      }
      // 可以根据需要添加更多对不同响应结构的解析逻辑

      console.log('DefaultProvider search results:', searchResults); // 调试输出

      // 返回格式化的结果
      return { results: searchResults };

    } catch (error: any) {
      console.error('DefaultProvider search error:', error.response?.data || error.message);
      // 即使出错也返回空结果数组，让 checkSearch 判断为失败
      return { results: [] };
    }
  }
}
