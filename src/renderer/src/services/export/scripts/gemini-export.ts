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
 * 说明：自动滚动侧栏加载全部会话，逐个点击会话并抓取主窗口聊天消息，返回统一结构
 */
export const buildGeminiExportScript = (): string =>
  String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const textFrom = (node) => (node?.textContent || '').trim();

    // 等待侧栏和聊天区域挂载
    const waitForSideNav = async () => {
      for (let i = 0; i < 60; i += 1) {
        const list = document.querySelector('conversations-list .conversations-container .conversation');
        if (list) return true;
        await sleep(300);
      }
      return false;
    };

    const waitForChatHistory = async () => {
      for (let i = 0; i < 60; i += 1) {
        const history = document.querySelector('#chat-history .conversation-container');
        if (history) return history;
        await sleep(300);
      }
      return null;
    };

    // 侧栏会话节点收集
    const collectSideNavItems = () => {
      const nodes = Array.from(
        document.querySelectorAll('conversations-list .conversations-container .conversation[data-test-id="conversation"]')
      );
      const seen = new Set();
      const results = [];
      nodes.forEach((node, idx) => {
        const dataId =
          node.getAttribute('id') ||
          node.getAttribute('data-id') ||
          node.getAttribute('data-conversation-id') ||
          node.getAttribute('jslog') ||
          '';
        const id = dataId || 'gemini-' + (idx + 1);
        if (seen.has(id)) return;
        seen.add(id);
        results.push({ id, node });
      });
      return results;
    };

    // 等待点击后聊天内容加载
    const waitConversationLoaded = async () => {
      for (let i = 0; i < 50; i += 1) {
        const hasContent = document.querySelector(
          '#chat-history .conversation-container .user-query, #chat-history .conversation-container model-response, #chat-history .conversation-container .model-response-text'
        );
        if (hasContent) return true;
        await sleep(200);
      }
      return false;
    };

    // 抽取当前聊天窗口消息
    const extractCurrentConversation = (id, title) => {
      const messages = [];
      const container = document.querySelector('#chat-history');
      if (!container) return { id, title, messages };
      const items = Array.from(
        container.querySelectorAll(
          '.conversation-container user-query, .conversation-container .user-query, .conversation-container model-response, .conversation-container .model-response-text, .conversation-container .model-error, .conversation-container model-thoughts, .conversation-container [data-test-id="model-thoughts"]'
        )
      );

      items.forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const isUser = tag === 'user-query' || el.classList.contains('user-query');
        const isThought = tag === 'model-thoughts' || el.getAttribute('data-test-id') === 'model-thoughts';
        const content =
          textFrom(
            el.querySelector(
              '.query-text, .markdown, .model-response-text, .thoughts-wrapper, p, span, .response-container'
            ) || el
          ) || '';
        if (!content) return;
        messages.push({ role: isUser ? 'user' : isThought ? 'thought' : 'assistant', content });
      });

      return { id, title, messages };
    };

    const scrollSideNav = async () => {
      const scroller = document.querySelector('.chat-history-list .conversation-items-container')?.parentElement;
      if (!scroller) return;
      let last = -1;
      for (let i = 0; i < 30; i += 1) {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
        await sleep(200);
        const h = scroller.scrollHeight;
        if (h === last) break;
        last = h;
      }
    };

    try {
      const historyReady = await waitForChatHistory();
      const sidenavReady = await waitForSideNav();
      if (!historyReady || !sidenavReady) {
        return { conversations: [], error: 'gemini_side_nav_or_history_not_ready' };
      }

      await scrollSideNav();
      const items = collectSideNavItems();
      if (!items.length) {
        return { conversations: [], error: 'gemini_conversation_list_empty' };
      }

      const conversations = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const title =
          textFrom(item.node.querySelector('.conversation-title')) ||
          textFrom(item.node.querySelector('.gds-label-l')) ||
          'Conversation ' + (i + 1);
        try {
          item.node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          const loaded = await waitConversationLoaded();
          if (!loaded) continue;
          const conv = extractCurrentConversation(item.id, title);
          if (conv.messages.length > 0) {
            conversations.push(conv);
          }
        } catch (err) {
          console.warn('capture fail', item.id, err);
        }
      }

      return { conversations };
    } catch (error) {
      return { conversations: [], error: error?.message || 'gemini_export_failed' };
    }
  })()`
