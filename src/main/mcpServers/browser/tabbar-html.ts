export const TAB_BAR_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      user-select: none;
    }
    body {
      background: #202124;
      display: flex;
      flex-direction: column;
    }
    #tab-row {
      display: flex;
      align-items: flex-end;
      padding: 0 8px;
      height: 34px;
      flex-shrink: 0;
    }
    #tabs-container {
      display: flex;
      align-items: flex-end;
      height: 34px;
      flex: 1;
      overflow-x: auto;
      overflow-y: hidden;
    }
    #tabs-container::-webkit-scrollbar { display: none; }
    .tab {
      display: flex;
      align-items: center;
      height: 28px;
      min-width: 60px;
      max-width: 200px;
      padding: 0 8px 0 12px;
      margin-right: 1px;
      background: #35363a;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      transition: background 0.1s;
      flex-shrink: 0;
    }
    .tab:hover { background: #3c3d41; }
    .tab.active { background: #4a4b4f; height: 32px; }
    .tab-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #9aa0a6;
      font-size: 12px;
    }
    .tab.active .tab-title { color: #e8eaed; }
    .tab-close {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: 4px;
      opacity: 0;
      transition: opacity 0.1s, background 0.1s;
    }
    .tab:hover .tab-close, .tab.active .tab-close { opacity: 1; }
    .tab-close:hover { background: rgba(255,255,255,0.1); }
    .tab-close svg { width: 10px; height: 10px; fill: #9aa0a6; }
    .tab-close:hover svg { fill: #e8eaed; }
    #new-tab-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      margin-left: 4px;
    }
    #new-tab-btn:hover { background: rgba(255,255,255,0.1); }
    #new-tab-btn svg { width: 14px; height: 14px; fill: #9aa0a6; }
    .empty-state { color: #9aa0a6; padding: 8px 12px; }
    #address-bar {
      display: flex;
      align-items: center;
      padding: 4px 8px 6px 8px;
      gap: 4px;
      background: #202124;
    }
    .nav-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      background: transparent;
      border: none;
      flex-shrink: 0;
    }
    .nav-btn:hover { background: rgba(255,255,255,0.1); }
    .nav-btn:disabled { opacity: 0.3; cursor: default; }
    .nav-btn:disabled:hover { background: transparent; }
    .nav-btn svg { width: 16px; height: 16px; fill: #9aa0a6; }
    #url-container {
      flex: 1;
      display: flex;
      align-items: center;
      background: #35363a;
      border-radius: 16px;
      padding: 0 12px;
      height: 28px;
    }
    #url-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #e8eaed;
      font-size: 13px;
      font-family: inherit;
    }
    #url-input::placeholder { color: #9aa0a6; }
    #url-input::-webkit-input-placeholder { color: #9aa0a6; }
  </style>
</head>
<body>
  <div id="tab-row">
    <div id="tabs-container"><div class="empty-state">No tabs open</div></div>
    <div id="new-tab-btn" title="New tab">
      <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    </div>
  </div>
  <div id="address-bar">
    <button class="nav-btn" id="back-btn" title="Back" disabled>
      <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
    </button>
    <button class="nav-btn" id="forward-btn" title="Forward" disabled>
      <svg viewBox="0 0 24 24"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
    </button>
    <button class="nav-btn" id="refresh-btn" title="Refresh">
      <svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
    </button>
    <div id="url-container">
      <input type="text" id="url-input" placeholder="Enter URL or search..." spellcheck="false" />
    </div>
  </div>
  <script>
    const tabsContainer = document.getElementById('tabs-container');
    const newTabBtn = document.getElementById('new-tab-btn');
    const urlInput = document.getElementById('url-input');
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    
    window.currentUrl = '';
    window.canGoBack = false;
    window.canGoForward = false;
    
    window.updateTabs = function(tabs, activeUrl, canGoBack, canGoForward) {
      if (!tabs || tabs.length === 0) {
        tabsContainer.innerHTML = '<div class="empty-state">No tabs open</div>';
        urlInput.value = '';
        return;
      }
      tabsContainer.innerHTML = tabs.map(function(tab) {
        var cls = 'tab' + (tab.isActive ? ' active' : '');
        var title = (tab.title || 'New Tab').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        var url = (tab.url || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return '<div class="' + cls + '" data-id="' + tab.id + '" title="' + url + '">' +
          '<span class="tab-title">' + title + '</span>' +
          '<div class="tab-close" data-id="' + tab.id + '">' +
            '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
          '</div>' +
        '</div>';
      }).join('');
      
      if (activeUrl !== undefined) {
        window.currentUrl = activeUrl || '';
        if (document.activeElement !== urlInput) {
          urlInput.value = window.currentUrl;
        }
      }
      
      if (canGoBack !== undefined) {
        window.canGoBack = canGoBack;
        backBtn.disabled = !canGoBack;
      }
      if (canGoForward !== undefined) {
        window.canGoForward = canGoForward;
        forwardBtn.disabled = !canGoForward;
      }
    };
    
    function sendAction(action) {
      window.postMessage({ channel: 'tabbar-action', payload: action }, '*');
    }
    
    tabsContainer.addEventListener('click', function(e) {
      var closeBtn = e.target.closest('.tab-close');
      if (closeBtn) { 
        e.stopPropagation(); 
        sendAction({ type: 'close', tabId: closeBtn.dataset.id });
        return; 
      }
      var tab = e.target.closest('.tab');
      if (tab) { 
        sendAction({ type: 'switch', tabId: tab.dataset.id });
      }
    });
    
    tabsContainer.addEventListener('auxclick', function(e) {
      if (e.button === 1) {
        var tab = e.target.closest('.tab');
        if (tab) { 
          sendAction({ type: 'close', tabId: tab.dataset.id });
        }
      }
    });
    
    newTabBtn.addEventListener('click', function() { 
      sendAction({ type: 'new' });
    });
    
    urlInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var url = urlInput.value.trim();
        if (url) {
          sendAction({ type: 'navigate', url: url });
        }
      }
    });
    
    urlInput.addEventListener('focus', function() {
      urlInput.select();
    });
    
    backBtn.addEventListener('click', function() {
      if (window.canGoBack) {
        sendAction({ type: 'back' });
      }
    });
    
    forwardBtn.addEventListener('click', function() {
      if (window.canGoForward) {
        sendAction({ type: 'forward' });
      }
    });
    
    refreshBtn.addEventListener('click', function() {
      sendAction({ type: 'refresh' });
    });
  </script>
</body>
</html>`
