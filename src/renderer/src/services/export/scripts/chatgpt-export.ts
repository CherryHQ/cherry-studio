export interface ChatGPTExportResult {
  conversations: any[]
  error?: string
  meta?: {
    /** 个人空间 / 团队空间 */
    mode: 'personal' | 'team'
    /** 团队空间 Workspace ID（团队空间时必填） */
    workspaceId?: string
  }
}

/**
 * 构造在 ChatGPT WebView 中执行的导出脚本
 * 说明：脚本返回 { conversations, error? }，其中 conversations 为官方导出结构数组
 *
 * 团队空间导出参考：
 * - ChatGPT Universal Exporter Enhanced (Fixed + Incremental Export)-8.4.0.user.js
 *
 * 关键点：
 * - 团队空间需要在请求头中附加 `ChatGPT-Account-Id: <workspaceId>` 才能列出团队对话/项目对话
 */
export const buildChatGPTExportScript = (): string =>
  String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const BASE_DELAY = 120;
    const JITTER = 80;
    const PAGE_LIMIT = 50;
    const jitter = () => BASE_DELAY + Math.random() * JITTER;

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

    const fetchWithRetry = async (input, init = {}, retries = 3) => {
      let attempt = 0;
      while (true) {
        try {
          const res = await fetch(input, init);
          if (res.ok) return res;
          if (attempt < retries && (res.status === 429 || res.status >= 500)) {
            await sleep(BASE_DELAY * Math.pow(2, attempt) + Math.random() * JITTER);
            attempt += 1;
            continue;
          }
          return res;
        } catch (err) {
          if (attempt < retries) {
            await sleep(BASE_DELAY * Math.pow(2, attempt) + Math.random() * JITTER);
            attempt += 1;
            continue;
          }
          throw err;
        }
      }
    };

    const getOaiDeviceId = () => {
      const cookieString = document.cookie || '';
      const match = cookieString.match(/oai-did=([^;]+)/);
      return match ? match[1] : null;
    };

    const buildHeaders = (token, workspaceId) => {
      const headers = { Authorization: 'Bearer ' + token };
      const did = getOaiDeviceId();
      if (did) headers['oai-device-id'] = did;
      if (workspaceId) headers['ChatGPT-Account-Id'] = workspaceId;
      return headers;
    };

    const ensureProgressUI = () => {
      const existing = document.getElementById('cherry-chatgpt-export-progress');
      if (existing) return existing;
      const el = document.createElement('div');
      el.id = 'cherry-chatgpt-export-progress';
      Object.assign(el.style, {
        position: 'fixed',
        bottom: '18px',
        right: '18px',
        zIndex: '2147483647',
        padding: '10px 12px',
        borderRadius: '10px',
        border: '1px solid rgba(0,0,0,0.12)',
        background: 'rgba(255,255,255,0.92)',
        color: '#111',
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        boxShadow: '0 6px 18px rgba(0,0,0,.12)',
        maxWidth: '280px',
        lineHeight: '1.4'
      });
      el.textContent = '准备导出…';
      document.body.appendChild(el);
      return el;
    };

    const updateProgress = (text) => {
      try {
        const el = ensureProgressUI();
        el.textContent = text;
      } catch (_) {}
    };

    const removeProgress = () => {
      try {
        const el = document.getElementById('cherry-chatgpt-export-progress');
        if (el && el.parentElement) el.parentElement.removeChild(el);
      } catch (_) {}
    };

    // --- 工作空间自动检测（参考 userscript）---
    const detectAllWorkspaceIds = () => {
      const foundIds = new Set();

      try {
        const data = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
        const accounts = data && data.props && data.props.pageProps && data.props.pageProps.user && data.props.pageProps.user.accounts;
        if (accounts) {
          Object.values(accounts).forEach((acc) => {
            if (acc && acc.account && acc.account.id) foundIds.add(acc.account.id);
          });
        }
      } catch (e) {}

      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (!key) continue;
          if (!key.includes('account') && !key.includes('workspace')) continue;
          const value = localStorage.getItem(key);
          if (!value) continue;
          const unquoted = value.replace(/"/g, '');
          if (
            /^ws-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(unquoted) ||
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(unquoted)
          ) {
            foundIds.add(unquoted);
          }
        }
      } catch (e) {}

      return Array.from(foundIds);
    };

    const getExportOptions = async () => {
      return await new Promise((resolve) => {
        if (document.getElementById('cherry-chatgpt-export-dialog-overlay')) {
          resolve({ cancelled: true });
          return;
        }

        const ids = detectAllWorkspaceIds();

        const overlay = document.createElement('div');
        overlay.id = 'cherry-chatgpt-export-dialog-overlay';
        Object.assign(overlay.style, {
          position: 'fixed',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.45)',
          zIndex: '2147483646',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        });

        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
          background: '#fff',
          borderRadius: '12px',
          padding: '18px',
          width: '480px',
          boxShadow: '0 10px 32px rgba(0,0,0,.25)',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          color: '#111'
        });

        const detected = ids.length ? ids.join(' , ') : '（未检测到）';
        dialog.innerHTML =
          '' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
          '  <div style="font-size:16px;font-weight:700;">导出 ChatGPT 会话</div>' +
          '  <button id="dlg-close" style="border:none;background:transparent;cursor:pointer;font-size:16px;line-height:1;">×</button>' +
          '</div>' +
          '<div style="margin-top:12px;font-size:12px;color:#555;">' +
          '  说明：个人空间无需额外参数；团队空间需要 Workspace ID（会自动检测，也可手动粘贴）。' +
          '</div>' +
          '<div style="margin-top:14px;">' +
          '  <label style="margin-right:12px;"><input type="radio" name="mode" value="personal" checked> 个人空间</label>' +
          '  <label><input type="radio" name="mode" value="team"> 团队空间</label>' +
          '</div>' +
          '<div id="team-area" style="display:none;margin-top:10px;">' +
          '  <div style="font-size:12px;color:#555;margin-bottom:6px;">自动检测到的 Workspace IDs：</div>' +
          '  <div style="font-size:12px;color:#333;word-break:break-all;margin-bottom:8px;">' +
          detected +
          '</div>' +
          '  <input id="team-id" type="text" placeholder="在此粘贴 Team Workspace ID（ws-...）" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;">' +
          '</div>' +
          '<div style="margin-top:14px;display:flex;justify-content:flex-end;gap:10px;">' +
          '  <button id="dlg-cancel" style="padding:8px 12px;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer;">取消</button>' +
          '  <button id="dlg-start" style="padding:8px 12px;border:none;border-radius:10px;background:#10a37f;color:#fff;cursor:pointer;font-weight:700;">开始导出</button>' +
          '</div>';

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const teamArea = dialog.querySelector('#team-area');
        const radioPersonal = dialog.querySelector('input[name="mode"][value="personal"]');
        const radioTeam = dialog.querySelector('input[name="mode"][value="team"]');
        const teamInput = dialog.querySelector('#team-id');

        const cleanup = () => {
          try {
            if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
          } catch (_) {}
        };

        const doCancel = () => {
          cleanup();
          resolve({ cancelled: true });
        };

        dialog.querySelector('#dlg-close').onclick = doCancel;
        dialog.querySelector('#dlg-cancel').onclick = doCancel;
        overlay.onclick = (e) => {
          if (e.target === overlay) doCancel();
        };

        const syncTeamArea = () => {
          teamArea.style.display = radioTeam.checked ? 'block' : 'none';
          if (radioTeam.checked && teamInput && !teamInput.value && ids[0]) {
            teamInput.value = ids[0];
          }
        };
        radioPersonal.addEventListener('change', syncTeamArea);
        radioTeam.addEventListener('change', syncTeamArea);
        syncTeamArea();

        dialog.querySelector('#dlg-start').onclick = () => {
          const mode = radioTeam.checked ? 'team' : 'personal';
          let workspaceId = null;
          if (mode === 'team') {
            const manual = String(teamInput && teamInput.value ? teamInput.value : '').trim();
            workspaceId = manual || (ids[0] || '');
            if (!workspaceId) {
              alert('请选择或输入一个有效的 Team Workspace ID！');
              return;
            }
          }
          cleanup();
          resolve({ cancelled: false, mode, workspaceId });
        };
      });
    };

    const listOrphanConversationIds = async (headers) => {
      const all = new Set();
      for (const isArchived of [false, true]) {
        let offset = 0;
        let page = 0;
        let hasMore = true;
        while (hasMore) {
          page += 1;
          updateProgress('列举对话列表…（' + (isArchived ? '已归档' : '活跃') + ' 第' + page + '页）');

          const url =
            '/backend-api/conversations?offset=' +
            offset +
            '&limit=' +
            PAGE_LIMIT +
            '&order=updated' +
            (isArchived ? '&is_archived=true' : '');

          const res = await fetchWithRetry(url, { headers, credentials: 'include' });
          if (!res.ok) throw new Error('chatgpt_list_failed_' + res.status);
          const data = await res.json();
          const items = Array.isArray(data && data.items) ? data.items : [];

          items.forEach((it) => {
            if (it && it.id) all.add(it.id);
          });

          if (data && data.has_more === false) {
            hasMore = false;
          } else if (items.length < PAGE_LIMIT) {
            hasMore = false;
          } else {
            offset += items.length;
            await sleep(jitter());
          }
        }
      }
      return Array.from(all);
    };

    const getProjects = async (headers) => {
      const res = await fetchWithRetry('/backend-api/gizmos/snorlax/sidebar', { headers, credentials: 'include' });
      if (!res.ok) return [];
      const data = await res.json();
      const projects = [];
      (data && data.items ? data.items : []).forEach((item) => {
        if (item && item.gizmo && item.gizmo.id && item.gizmo.display && item.gizmo.display.name) {
          projects.push({ id: item.gizmo.id, title: item.gizmo.display.name });
        }
      });
      return projects;
    };

    const listProjectConversationIds = async (headers, gizmoId) => {
      const all = new Set();
      let cursor = '0';
      let page = 0;
      while (cursor) {
        page += 1;
        updateProgress('列举项目对话…（第' + page + '页）');

        const url = '/backend-api/gizmos/' + gizmoId + '/conversations?cursor=' + cursor;
        const res = await fetchWithRetry(url, { headers, credentials: 'include' });
        if (!res.ok) throw new Error('chatgpt_project_list_failed_' + res.status);
        const data = await res.json();
        (data && data.items ? data.items : []).forEach((it) => {
          if (it && it.id) all.add(it.id);
        });
        cursor = data ? data.cursor : null;
        await sleep(jitter());
      }
      return Array.from(all);
    };

    const fetchConversationDetail = async (headers, conversationId) => {
      const res = await fetchWithRetry('/backend-api/conversation/' + conversationId, {
        headers,
        credentials: 'include'
      });
      if (!res.ok) {
        throw new Error('chatgpt_conversation_failed_' + conversationId + '_' + res.status);
      }
      const data = await res.json();
      data.__fetched_at = new Date().toISOString();
      return data;
    };

    const run = async () => {
      updateProgress('获取登录信息…');
      const token = await getAccessToken();

      const options = await getExportOptions();
      if (options && options.cancelled) {
        return { conversations: [], error: 'chatgpt_export_cancelled', meta: { mode: 'personal' } };
      }

      const mode = options && options.mode ? options.mode : 'personal';
      const workspaceId = mode === 'team' && options && options.workspaceId ? options.workspaceId : null;
      const headers = buildHeaders(token, workspaceId);

      const allIds = new Set();

      // 1) 项目外对话（活跃 + 已归档）
      const orphanIds = await listOrphanConversationIds(headers);
      orphanIds.forEach((id) => allIds.add(id));

      // 2) 团队空间：补齐项目(Project/Gizmo)内对话（参考 userscript）
      if (mode === 'team' && workspaceId) {
        updateProgress('获取团队项目列表…');
        const projects = await getProjects(headers);
        for (let i = 0; i < projects.length; i += 1) {
          updateProgress('扫描项目：' + projects[i].title + '…');
          try {
            const projectConvIds = await listProjectConversationIds(headers, projects[i].id);
            projectConvIds.forEach((id) => allIds.add(id));
          } catch (e) {
            // 项目列表可能因权限/灰度失败，跳过不影响其他对话导出
          }
        }
      }

      const ids = Array.from(allIds);
      if (ids.length === 0) {
        return { conversations: [], meta: { mode, workspaceId: workspaceId || undefined } };
      }

      const conversations = [];
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        updateProgress('下载对话详情…（' + (i + 1) + '/' + ids.length + '）');
        try {
          const detail = await fetchConversationDetail(headers, id);
          if (detail && typeof detail === 'object' && detail.mapping) {
            conversations.push(detail);
          }
        } catch (error) {
          // 不中断整体导出，尽量多拿到可用数据
        }
        await sleep(jitter());
      }

      return { conversations, meta: { mode, workspaceId: workspaceId || undefined } };
    };

    try {
      return await run();
    } catch (error) {
      return { conversations: [], error: (error && error.message) || 'chatgpt_export_failed', meta: { mode: 'personal' } };
    } finally {
      removeProgress();
    }
  })()`
