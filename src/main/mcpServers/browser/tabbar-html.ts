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

    /* Light theme (default) */
    :root {
      --bg-tabrow: #dee1e6;
      --bg-toolbar: #fff;
      --bg-tab-hover: rgba(0,0,0,0.04);
      --bg-tab-active: #fff;
      --bg-url: #f1f3f4;
      --bg-url-focus: #fff;
      --bg-btn-hover: rgba(0,0,0,0.08);
      --bg-favicon: #9aa0a6;
      --color-text: #5f6368;
      --color-text-active: #202124;
      --color-separator: #c4c7cc;
      --shadow-url-focus: 0 1px 6px rgba(32,33,36,0.28);
      --window-close-hover: #e81123;
    }

    /* Dark theme */
    body.theme-dark {
      --bg-tabrow: #202124;
      --bg-toolbar: #292a2d;
      --bg-tab-hover: rgba(255,255,255,0.06);
      --bg-tab-active: #292a2d;
      --bg-url: #35363a;
      --bg-url-focus: #202124;
      --bg-btn-hover: rgba(255,255,255,0.1);
      --bg-favicon: #5f6368;
      --color-text: #9aa0a6;
      --color-text-active: #e8eaed;
      --color-separator: #3c3d41;
      --shadow-url-focus: 0 1px 6px rgba(0,0,0,0.5);
      --window-close-hover: #e81123;
    }

    body {
      background: var(--bg-tabrow);
      display: flex;
      flex-direction: column;
      position: relative;
    }
    body.platform-mac { --traffic-light-width: 70px; --window-controls-width: 0px; }
    body.platform-win, body.platform-linux { --traffic-light-width: 0px; --window-controls-width: 138px; }

    /* Chrome-style tab row */
    #tab-row {
      display: flex;
      align-items: flex-end;
      padding: 8px 8px 0 8px;
      padding-left: calc(8px + var(--traffic-light-width, 0px));
      padding-right: calc(8px + var(--window-controls-width, 0px));
      height: 42px;
      flex-shrink: 0;
      -webkit-app-region: drag;
      background: var(--bg-tabrow);
      position: relative;
      z-index: 1;
    }

    #tabs-container {
      display: flex;
      align-items: flex-end;
      height: 34px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }

    /* New tab button - inside tabs container, right after last tab */
    #new-tab-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      margin-left: 4px;
      margin-bottom: 3px;
      -webkit-app-region: no-drag;
      flex-shrink: 0;
    }
    #new-tab-btn:hover { background: var(--bg-btn-hover); }
    #new-tab-btn svg { width: 18px; height: 18px; fill: var(--color-text); }

    /* Chrome-style tabs - shrink instead of scroll */
    .tab {
      position: relative;
      display: flex;
      align-items: center;
      height: 34px;
      min-width: 36px;
      max-width: 240px;
      flex: 1 1 240px;
      padding: 0 6px;
      background: transparent;
      cursor: pointer;
      -webkit-app-region: no-drag;
      border-radius: 8px 8px 0 0;
      transition: background 0.1s;
    }
    /* When tab is narrow, hide title, show favicon by default, show close on hover */
    .tab.narrow .tab-title { display: none; }
    .tab.narrow { justify-content: center; padding: 0; }
    .tab.narrow .tab-favicon { margin-right: 0; }
    .tab.narrow .tab-close { position: absolute; margin-left: 0; }
    /* On narrow tab hover, hide favicon and show close button */
    .tab.narrow:hover .tab-favicon { display: none; }
    .tab.narrow:hover .tab-close { opacity: 1; }
    /* Separator line using pseudo-element */
    .tab::after {
      content: '';
      position: absolute;
      right: 0;
      top: 8px;
      bottom: 8px;
      width: 1px;
      background: var(--color-separator);
      pointer-events: none;
    }
    /* Hide separator for last tab */
    .tab:last-of-type::after { display: none; }
    /* Hide separator when tab is hovered (right side) */
    .tab:hover::after { display: none; }
    /* Hide separator on tab before hovered tab (left side of hovered) - managed by JS .before-hover class */
    .tab.before-hover::after { display: none; }
    /* Hide separator for active tab and its neighbors */
    .tab.active::after { display: none; }
    /* Hide separator on tab before active (left side of active) - managed by JS .before-active class */
    .tab.before-active::after { display: none; }

    .tab:hover { background: var(--bg-tab-hover); }
    .tab.active {
      background: var(--bg-tab-active);
      z-index: 1;
    }

    /* Tab favicon placeholder */
    .tab-favicon {
      width: 16px;
      height: 16px;
      margin-right: 8px;
      border-radius: 2px;
      background: var(--bg-favicon);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tab-favicon svg { width: 12px; height: 12px; fill: #fff; }
    body.theme-dark .tab-favicon svg { fill: #9aa0a6; }

    .tab-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--color-text);
      font-size: 12px;
      font-weight: 400;
    }
    .tab.active .tab-title { color: var(--color-text-active); }

    .tab-close {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: 4px;
      opacity: 0;
      transition: opacity 0.1s, background 0.1s;
      flex-shrink: 0;
    }
    .tab:hover .tab-close { opacity: 1; }
    .tab-close:hover { background: var(--bg-btn-hover); }
    .tab-close svg { width: 16px; height: 16px; fill: var(--color-text); }
    .tab-close:hover svg { fill: var(--color-text-active); }

    /* Chrome-style address bar */
    #address-bar {
      display: flex;
      align-items: center;
      padding: 6px 16px 8px 8px;
      gap: 4px;
      background: var(--bg-toolbar);
      -webkit-app-region: drag;
    }
    .nav-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      background: transparent;
      border: none;
      flex-shrink: 0;
      -webkit-app-region: no-drag;
    }
    .nav-btn:hover { background: var(--bg-btn-hover); }
    .nav-btn:disabled { opacity: 0.3; cursor: default; }
    .nav-btn:disabled:hover { background: transparent; }
    .nav-btn svg { width: 20px; height: 20px; fill: var(--color-text); }

    #url-container {
      flex: 1;
      display: flex;
      align-items: center;
      background: var(--bg-url);
      border-radius: 24px;
      padding: 0 16px;
      height: 36px;
      -webkit-app-region: no-drag;
      transition: background 0.2s, box-shadow 0.2s;
    }
    #url-container:focus-within {
      background: var(--bg-url-focus);
      box-shadow: var(--shadow-url-focus);
    }
    #url-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--color-text-active);
      font-size: 14px;
      font-family: inherit;
    }
    #url-input::placeholder { color: var(--color-text); }
    #url-input::-webkit-input-placeholder { color: var(--color-text); }

    /* Window controls for Windows/Linux - use inline-flex inside tab-row instead of fixed position */
    #window-controls {
      display: none;
      height: 42px;
      margin-left: auto;
      margin-right: calc(-8px - var(--window-controls-width, 0px));
      margin-top: -8px;
      -webkit-app-region: no-drag;
    }
    body.platform-win #window-controls,
    body.platform-linux #window-controls { display: flex; }
    .window-control-btn {
      width: 46px;
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background 0.1s;
      -webkit-app-region: no-drag;
    }
    .window-control-btn:hover { background: var(--bg-btn-hover); }
    .window-control-btn.close:hover { background: var(--window-close-hover); }
    .window-control-btn svg { width: 10px; height: 10px; color: var(--color-text); fill: var(--color-text); stroke: var(--color-text); }
    .window-control-btn:hover svg { color: var(--color-text-active); fill: var(--color-text-active); stroke: var(--color-text-active); }
    .window-control-btn.close:hover svg { color: #fff; fill: #fff; stroke: #fff; }
  </style>
</head>
<body>
  <div id="tab-row">
    <div id="tabs-container">
      <div id="new-tab-btn" title="New tab">
        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </div>
    </div>
    <!-- Window controls for Windows/Linux - inside tab-row to avoid drag region issues -->
    <div id="window-controls">
      <button class="window-control-btn" id="minimize-btn" title="Minimize">
        <svg viewBox="0 0 10 1"><rect width="10" height="1"/></svg>
      </button>
      <button class="window-control-btn" id="maximize-btn" title="Maximize">
        <svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
      <button class="window-control-btn close" id="close-btn" title="Close">
        <svg viewBox="0 0 10 10"><path d="M0 0L10 10M10 0L0 10" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
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
      <input type="text" id="url-input" placeholder="Search or enter URL" spellcheck="false" />
    </div>
  </div>
  <script>
    const tabsContainer = document.getElementById('tabs-container');
    const urlInput = document.getElementById('url-input');
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const refreshBtn = document.getElementById('refresh-btn');

    window.currentUrl = '';
    window.canGoBack = false;
    window.canGoForward = false;

    // Helper function to update before-active class for separator hiding
    function updateBeforeActiveClass() {
      var tabs = tabsContainer.querySelectorAll('.tab');
      tabs.forEach(function(tab, index) {
        tab.classList.remove('before-active');
        if (index < tabs.length - 1 && tabs[index + 1].classList.contains('active')) {
          tab.classList.add('before-active');
        }
      });
    }

    // Helper function to update narrow class based on tab width
    function updateNarrowClass() {
      var tabs = tabsContainer.querySelectorAll('.tab');
      tabs.forEach(function(tab) {
        if (tab.offsetWidth < 72) {
          tab.classList.add('narrow');
        } else {
          tab.classList.remove('narrow');
        }
      });
    }

    var newTabBtnHtml = '<div id="new-tab-btn" title="New tab"><svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></div>';

    // Track if we're in "closing mode" where tab widths should be fixed
    var closingModeTimeout = null;
    var isInClosingMode = false;

    function enterClosingMode() {
      isInClosingMode = true;
      // Clear any existing timeout
      if (closingModeTimeout) {
        clearTimeout(closingModeTimeout);
      }
      // Set timeout to exit closing mode after 1 second of no activity
      closingModeTimeout = setTimeout(function() {
        exitClosingMode();
      }, 1000);
    }

    function exitClosingMode() {
      isInClosingMode = false;
      if (closingModeTimeout) {
        clearTimeout(closingModeTimeout);
        closingModeTimeout = null;
      }
      // Remove fixed widths from tabs
      var tabs = tabsContainer.querySelectorAll('.tab');
      tabs.forEach(function(tab) {
        tab.style.flex = '';
        tab.style.width = '';
      });
    }

    // Exit closing mode when mouse leaves the tab row
    document.getElementById('tab-row').addEventListener('mouseleave', function() {
      if (isInClosingMode) {
        exitClosingMode();
      }
    });

    window.updateTabs = function(tabs, activeUrl, canGoBack, canGoForward) {
      // Capture current tab widths before update if in closing mode
      var previousWidths = {};
      if (isInClosingMode) {
        var existingTabs = tabsContainer.querySelectorAll('.tab');
        existingTabs.forEach(function(tab) {
          previousWidths[tab.dataset.id] = tab.offsetWidth;
        });
      }

      if (!tabs || tabs.length === 0) {
        // Window will be closed by main process when last tab is closed
        // Just clear the UI in case this is called before window closes
        tabsContainer.innerHTML = newTabBtnHtml;
        urlInput.value = '';
        document.getElementById('new-tab-btn').addEventListener('click', function() {
          sendAction({ type: 'new' });
        });
        return;
      }
      tabsContainer.innerHTML = tabs.map(function(tab) {
        var cls = 'tab' + (tab.isActive ? ' active' : '');
        var title = (tab.title || 'New Tab').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        var url = (tab.url || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return '<div class="' + cls + '" data-id="' + tab.id + '" title="' + url + '">' +
          '<div class="tab-favicon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg></div>' +
          '<span class="tab-title">' + title + '</span>' +
          '<div class="tab-close" data-id="' + tab.id + '">' +
            '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
          '</div>' +
        '</div>';
      }).join('') + newTabBtnHtml;

      // Re-attach event listener for new tab button
      document.getElementById('new-tab-btn').addEventListener('click', function() {
        sendAction({ type: 'new' });
      });

      // If in closing mode, fix the widths of remaining tabs
      if (isInClosingMode) {
        var newTabs = tabsContainer.querySelectorAll('.tab');
        newTabs.forEach(function(tab) {
          var prevWidth = previousWidths[tab.dataset.id];
          if (prevWidth) {
            tab.style.flex = '0 0 ' + prevWidth + 'px';
            tab.style.width = prevWidth + 'px';
          }
        });
      }

      // Update before-active class for proper separator hiding
      updateBeforeActiveClass();
      // Update narrow class based on tab width
      updateNarrowClass();

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
        enterClosingMode();
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
          enterClosingMode();
          sendAction({ type: 'close', tabId: tab.dataset.id });
        }
      }
    });

    // Handle hover state for separator hiding (left side of hovered tab)
    tabsContainer.addEventListener('mouseover', function(e) {
      var tab = e.target.closest('.tab');
      // Clear all before-hover classes first
      tabsContainer.querySelectorAll('.before-hover').forEach(function(t) {
        t.classList.remove('before-hover');
      });
      if (tab) {
        var prev = tab.previousElementSibling;
        if (prev && prev.classList.contains('tab')) {
          prev.classList.add('before-hover');
        }
      }
    });

    tabsContainer.addEventListener('mouseleave', function() {
      tabsContainer.querySelectorAll('.before-hover').forEach(function(t) {
        t.classList.remove('before-hover');
      });
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

    // Window controls for Windows/Linux
    document.getElementById('minimize-btn').addEventListener('click', function() {
      sendAction({ type: 'window-minimize' });
    });
    document.getElementById('maximize-btn').addEventListener('click', function() {
      sendAction({ type: 'window-maximize' });
    });
    document.getElementById('close-btn').addEventListener('click', function() {
      sendAction({ type: 'window-close' });
    });

    // Platform initialization - called from main process
    window.initPlatform = function(platform) {
      document.body.classList.add('platform-' + platform);
    };

    // Theme initialization - called from main process
    window.setTheme = function(isDark) {
      if (isDark) {
        document.body.classList.add('theme-dark');
      } else {
        document.body.classList.remove('theme-dark');
      }
    };

    // Update narrow class on window resize
    window.addEventListener('resize', function() {
      updateNarrowClass();
    });
  </script>
</body>
</html>`
