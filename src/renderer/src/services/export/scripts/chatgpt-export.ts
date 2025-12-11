export interface ChatGPTExportResult {
  conversations: any[]
}

/**
 * 构造在 ChatGPT WebView 中执行的导出脚本
 * 说明：脚本返回 { conversations }，其中 conversations 为官方导出结构数组
 */
export const buildChatGPTExportScript = (): string =>
  String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const getAccessToken = async () => {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (!res.ok) {
        throw new Error('chatgpt_session_failed');
      }
      const data = await res.json();
      if (!data || !data.accessToken) {
        throw new Error('chatgpt_access_token_missing');
      }
      return data.accessToken;
    };

    const fetchList = async (token) => {
      const limit = 50;
      let offset = 0;
      const items = [];

      while (true) {
        const res = await fetch('/backend-api/conversations?offset=' + offset + '&limit=' + limit, {
          headers: { Authorization: 'Bearer ' + token },
          credentials: 'include'
        });
        if (!res.ok) {
          throw new Error('chatgpt_list_failed_' + res.status);
        }
        const data = await res.json();
        const pageItems = Array.isArray(data?.items) ? data.items : [];
        items.push(...pageItems);

        if (!data?.has_more || pageItems.length < limit) {
          break;
        }

        offset += pageItems.length;
        await sleep(150);
      }

      return items;
    };

    const fetchConversationDetail = async (token, conversationId) => {
      const res = await fetch('/backend-api/conversation/' + conversationId, {
        headers: { Authorization: 'Bearer ' + token },
        credentials: 'include'
      });
      if (!res.ok) {
        throw new Error('chatgpt_conversation_failed_' + conversationId + '_' + res.status);
      }
      return await res.json();
    };

    const run = async () => {
      const token = await getAccessToken();
      const list = await fetchList(token);
      if (!Array.isArray(list) || list.length === 0) {
        return { conversations: [] };
      }

      const conversations = [];
      for (const item of list) {
        if (!item?.id) continue;
        try {
          const detail = await fetchConversationDetail(token, item.id);
          if (detail && typeof detail === 'object' && detail.mapping) {
            conversations.push(detail);
          }
        } catch (error) {
          console.warn('Skip conversation due to fetch error', item?.id, error);
        }
      }

      return { conversations };
    };

    return await run();
  })()`
