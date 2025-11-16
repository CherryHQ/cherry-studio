Windows PowerShell
Copyright (C) Microsoft Corporation. All rights reserved.

Install the latest PowerShell for new features and improvements! https://aka.ms/PSWindows

PS D:\automatseo> yarn dev
rolldown-vite v7.1.5 building SSR bundle for development...
✓ 5407 modules transformed.
out/main/tray_icon_light.png       1.78 kB
out/main/tray_icon_dark.png        2.13 kB
out/main/tray_icon.png             4.09 kB
out/main/icon.png                140.06 kB
out/main/index.js             23,650.81 kB │ map: 44,128.44 kB
[EVAL] Warning: Use of `eval` function is strongly discouraged as it poses security risks and may cause issues with minification.
    ╭─[ node_modules/@protobufjs/inquire/index.js:12:19 ]
    │
 12 │         var mod = eval("quire".replace(/^/,"re"))(moduleName); // eslint-disable-line no-eval
    │                   ──┬─  
    │                     ╰─── Use of `eval` function here.
────╯

✓ built in 8.46s

build the electron main process successfully

-----                                                                                                                                                                                                                
                                                                                                                                                                                                                     
rolldown-vite v7.1.5 building SSR bundle for development...
✓ 3 modules transformed.
out/preload/index.js  50.82 kB │ map: 73.34 kB
✓ built in 24ms

build the electron preload files successfully                                                                                                                                                                        

-----                                                                                                                                                                                                                
                                                                                                                                                                                                                     
You or a plugin you are using have set `optimizeDeps.esbuildOptions` but this option is now deprecated. Vite now uses Rolldown to optimize the dependencies. Please use `optimizeDeps.rollupOptions` instead.
dev server running for the electron renderer process at:
                                                                                                                                                                                                                     
  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose

start electron app...                                                                                                                                                                                                
                                                                                                                                                                                                                     

04:23:35.930 <DEBUG> [MCPApiService] MCPApiService initialized
04:23:35.949 <INFO> [PluginService] PluginService initialized { maxFileSize: 1048576, cacheTimeout: 300000 }
04:23:35.997 <INFO> [OpenAPIMiddleware] OpenAPI documentation ready { docsPath: '/api-docs', specPath: '/api-docs.json' }
04:23:36.003 <INFO> [UpdateProviderManager] UpdateProviderManager initialized
04:23:36.004 <INFO> [UpdateDownloader] UpdateDownloader initialized {
  downloadDirectory: 'C:\\Users\\User\\AppData\\Roaming\\cherrystudioDev\\updates\\downloads'
}
04:23:36.004 <INFO> [LicenseValidator] LicenseValidator initialized
04:23:36.005 <INFO> [UpdateManager] UpdateManager initialized
04:23:36.014 <INFO> [CodeToolsService] Preloading available terminals...
04:23:36.015 <INFO> [CodeToolsService] Checking available terminals in parallel...
(node:37716) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.
(Use `electron --trace-deprecation ...` to show where the warning was created)
04:23:36.401 <INFO> [CodeToolsService] Terminal availability check completed in 386ms, found 3 terminals
04:23:36.402 <INFO> [CodeToolsService] Terminal preloading completed
04:23:36.408 <DEBUG> [VersionService] Version information not changed, skip recording
04:23:36.684 <INFO> [PowerMonitorService] Windows shutdown handler registered
04:23:36.684 <INFO> [PowerMonitorService] PowerMonitorService initialized { platform: 'win32' }
04:23:36.688 <INFO> [PowerMonitorService] Shutdown handler registered { totalHandlers: 1 }
04:23:36.688 <INFO> [PowerMonitorService] Shutdown handler registered { totalHandlers: 2 }
04:23:36.789 <INFO> [SelectionService] SelectionService Started
04:23:36.790 <INFO> [BaseService] Initializing Agent database at: C:\Users\User\.cherrystudio\data\agents.db (attempt 1/3)
04:23:36.794 <INFO> [MigrationService] Starting migration check...
(electron) 'session.loadExtension' is deprecated and will be removed. Please use 'session.extensions.loadExtension' instead.
04:23:36.805 <INFO> [MigrationService] Latest applied migration: v2, latest available: v2
04:23:36.806 <INFO> [MigrationService] Database is up to date
04:23:36.806 <INFO> [BaseService] Agent database initialized successfully
04:23:36.807 <INFO> [MainEntry] Agent service initialized successfully
(node:37716) ExtensionLoadWarning: Warnings loading extension at C:\Users\User\AppData\Roaming\cherrystudioDev\extensions\lmhkpmbekcpmknklioeibfkpmmfibljd:
  Permission 'notifications' is unknown.
  Permission 'contextMenus' is unknown.

[37716:1117/042336.977:ERROR:extensions\browser\extensions_browser_client.cc:72] Extension Error:
  OTR:     false
  Level:   1
  Source:  manifest.json
  Message: Service worker registration failed. Status code: 2
  ID:      lmhkpmbekcpmknklioeibfkpmmfibljd
  Type:    ManifestError
04:23:36.978 <INFO> [MainEntry] Added Extension:  React Developer Tools
[37716:1117/042336.983:ERROR:extensions\browser\extensions_browser_client.cc:72] Extension Error:
  OTR:     false
  Level:   1
  Source:  manifest.json
  Message: Service worker registration failed. Status code: 2
  ID:      npgeppikpcejdpflglfblkjianjcpmon
  Type:    ManifestError
[37716:1117/042354.585:ERROR:extensions\browser\service_worker\service_worker_task_queue.cc:426] DidStartWorkerFail lmhkpmbekcpmknklioeibfkpmmfibljd: 5
DEV: Forcing window to show in development mode
[37716:1117/042357.703:ERROR:extensions\browser\service_worker\service_worker_task_queue.cc:426] DidStartWorkerFail lmhkpmbekcpmknklioeibfkpmmfibljd: 5
04:23:58.863 <INFO> [MainEntry] API server config: {
  enabled: false,
  port: 23333,
  host: 'localhost',
  apiKey: 'cs-sk-7464b001-9774-4f67-a49a-97aba669cfec'
}
[37716:1117/042400.173:ERROR:extensions\browser\service_worker\service_worker_task_queue.cc:426] DidStartWorkerFail lmhkpmbekcpmknklioeibfkpmmfibljd: 5
04:24:03.608 <DEBUG> [ApiServer] isRunning check { hasServer: false, isListening: false, result: false }
04:24:03.613 <DEBUG> [ApiServer] isRunning check { hasServer: false, isListening: false, result: false }
04:24:03.613 <DEBUG> [ApiServer] isRunning check { hasServer: false, isListening: false, result: false }
04:24:03.621 <DEBUG> [ApiServer] isRunning check { hasServer: false, isListening: false, result: false }
04:24:03.691 <DEBUG> [ApiServer] isRunning check { hasServer: false, isListening: false, result: false }
04:24:03.722 <INFO> [ProxyManager] configureProxy: system undefined undefined
04:24:04.806 <DEBUG> [IPC] disk space { diskPath: 'C:', free: 188553682944, size: 999289778176 }
