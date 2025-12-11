export interface GeminiExportMessage {
  role: 'user' | 'assistant' | 'thought'
  content: string
}

export interface GeminiExportConversation {
  id: string
  title: string
  url?: string
  messages: GeminiExportMessage[]
}

export interface GeminiExportResult {
  conversations: GeminiExportConversation[]
}

/**
 * 构造在 Gemini WebView 中执行的导出脚本
 * 说明：脚本尝试滚动加载侧栏记录，并按 DOM 顺序抽取用户与回复内容
 */
export const buildGeminiExportScript = (): string =>
  String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const textFrom = (node) => (node?.textContent || '').trim();

    const ensureHistoryLoaded = async (container) => {
      let lastHeight = -1;
      for (let i = 0; i < 10; i += 1) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        await sleep(250);
        const currentHeight = container.scrollHeight;
        if (currentHeight === lastHeight) {
          break;
        }
        lastHeight = currentHeight;
      }
    };

    const run = async () => {
      const history = document.querySelector('#chat-history');
      if (!history) {
        throw new Error('gemini_history_not_found');
      }

      await ensureHistoryLoaded(history);

      const conversations = [];
      const nodes = Array.from(history.querySelectorAll('.conversation-container'));

      nodes.forEach((node, index) => {
        const id = node.getAttribute('data-id') || 'gemini-' + (index + 1);
        const title =
          textFrom(node.querySelector('.conversation-title')) ||
          textFrom(node.querySelector('.title')) ||
          'Conversation ' + (index + 1);
        const url = node.querySelector('a')?.href || undefined;

        const messages = [];
        const messageNodes = Array.from(
          node.querySelectorAll('.user-query, .model-response-text, .model-response, .model-error')
        );

        messageNodes.forEach((msg) => {
          if (msg.classList.contains('user-query')) {
            const content = textFrom(msg.querySelector('.query-text') || msg);
            if (content) {
              messages.push({ role: 'user', content });
            }
            return;
          }

          const isThought = msg.getAttribute('data-thinking') === 'true' || msg.classList.contains('thinking');
          const content = textFrom(msg.querySelector('.markdown') || msg);
          if (content) {
            messages.push({ role: isThought ? 'thought' : 'assistant', content });
          }
        });

        if (messages.length > 0) {
          conversations.push({ id, title, url, messages });
        }
      });

      return { conversations };
    };

    return await run();
  })()`
