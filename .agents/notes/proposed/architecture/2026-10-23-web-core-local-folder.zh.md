# Agent Note: Web Core Agent 本地文件夹

Status: proposed

[English](2026-10-23-web-core-local-folder.md) | 中文

## Problem

Web 版的 Agent 只能在浏览器私有存储里的工作区中工作([Agent Spec](2026-10-21-web-core-agent.md)),无法编辑用户自己的文件,而桌面端由用户选择的工作区正是为此而设;Agent Spec 把它留在了范围之外。设计文档把通过 File System Access API 访问本地文件夹列为 Web 版 Agent 的下一步。

桌面端的输入框已经支持用户选择工作区:工作区选择器调用 `window.api.file.selectFolder`,通过 `ai.agent.workspace.register` 路由登记所选路径,会话就在这个目录里运行。Web 版中文件夹对话框没有处理程序,这个路由背后的服务也被替换了,所以选择器会失败。

浏览器只能通过 `showDirectoryPicker()` 以 `FileSystemDirectoryHandle` 的形式把文件夹交给页面,而且只有基于 Chromium 的浏览器(Chrome、Edge)提供它。选择框需要页面里的用户操作才能打开;页面重新加载后,可能还要再次请求权限,同样需要用户操作。ZenFS 的 `WebAccess` 后端负责挂载账号的 OPFS 目录,它在挂载时把文件夹里的每个文件读进内存,并维护一份看不到应用外修改的索引,所以不能用来挂载用户的项目。

## Proposal

桌面端的选择器、登记路由和会话宿主都不改;由 Web 版应答文件夹对话框,并把所选文件夹挂载到 Worker 的文件系统中。所有改动都在 `packages/web-core` 内。

1. **选择文件夹。** 页面自己应答 `IpcChannel.File_SelectFolder`,就在发起请求的那次点击里调用 `showDirectoryPicker({ mode: 'readwrite' })`,再把句柄交给 Worker,由 Worker 返回文件夹路径。用户取消时返回 `null`,与桌面端对话框一致。浏览器没有选择框时,弹出提示说明本地文件夹需要 Chrome 或 Edge,并返回 `null`。
2. **文件夹文件系统。** Worker 中新增一个 ZenFS 后端 `LocalFolderFS`,每个调用都在发生时直接作用于目录句柄:不预读、不缓存、不建索引,所以用户在其他程序里改动的文件总是最新的。只实现异步调用;同步调用以 `ENOTSUP` 失败。文件工具和审批策略(`realpath`)只用异步调用;Worker 的 `fs.promises.rename` 为了避开 ZenFS 异步重命名的缺陷而使用同步重命名,在本地文件夹上改用异步重命名。
3. **路径和存储。** 文件夹挂载在 `/local/<id>/<文件夹名>`,并以这个路径登记为用户工作区,所以输入框、会话和审批策略对待它的方式与桌面端对待用户所选文件夹一致。句柄按账号保存在 IndexedDB(`cherry-studio-local-folders`)中,账号打开时挂载。再次选择已保存的文件夹(`isSameEntry`)会沿用原来的 id,因而保留原来的工作区。`ai.agent.workspace.register` 只接受已保存文件夹的路径。
4. **重新加载后的权限。** 账号打开时,权限不是 `granted` 的文件夹挂载为不可用:每个调用都以 `EACCES` 失败,并提示需要重新允许访问,因此不会有内容被写到别处。第一次出现这种调用时,Worker 请页面弹出一条带"允许"按钮的警告提示;点击按钮会调用 `requestPermission`,随后 Worker 挂载该文件夹。重新选择这个文件夹也能恢复访问。
5. **Agent 提示词。** 基础提示词告诉模型,它的工作区是在浏览器私有存储里,还是用户电脑上的文件夹。
6. **测试。** 用一个 OPFS 目录句柄代替所选文件夹:它的句柄 API 相同,只是没有对话框。
   - `e2e/localFolder.spec.ts`(harness,Chromium、WebKit 和 Firefox)在所选文件夹上调用 Worker 的 `fs.promises`,并在 Worker 中模拟权限失效,检查不可用挂载和访问请求。
   - `e2e/agent.spec.ts` 新增一个 Chromium 测试:在输入框中选择文件夹,Agent 经审批后在其中写入文件,重新加载后再读出;另有一个在三个浏览器中运行的测试,覆盖没有选择框的浏览器。

Python 和 JavaScript 都无法访问本地文件夹:Pyodide 运行在沙箱 iframe 的不透明源中,打不开应用的 IndexedDB;QuickJS 不向脚本提供任何浏览器 API。

不在范围内:删除工作区(它会删除该工作区的会话,Web 版尚不支持),Firefox 和 Safari 中的本地文件夹,以及监听文件夹变化。

## Alternatives considered

- **用 ZenFS `WebAccess` 挂载文件夹。** 它适合账号自己的 OPFS 目录,但挂载时会遍历整个文件夹并把每个文件复制进内存;带 `node_modules` 或 `.git` 的项目打不开,索引也看不到外部修改。
- **把文件夹复制到 OPFS。** Agent 改的是副本,用户的文件不会变化。
- **账号打开时就重新请求权限。** `requestPermission` 需要用户操作;每次访问都为每个已保存的文件夹弹出请求,会问到用户可能并不使用的文件夹。
- **Web 专用的工作区选择器。** 只要应答了对话框和路由,桌面端的选择器已经满足需要。

## Acceptance criteria

- AC1 — 在 Chromium 中,在输入框的工作区选择器里选择一个文件夹,会把它登记为以该文件夹命名的工作区;`default` 模式下的一轮 Agent 对话经审批后在其中写入文件,文件出现在所选目录里。(verification: packaged artifact)
- AC2 — 重新加载后,会话的工作区仍是同一个文件夹,Agent 能读出它写入的文件。(verification: packaged artifact)
- AC3 — 对权限未授予的文件夹,文件调用以访问提示失败,不写入任何内容,并请页面提供一次访问入口;允许访问后,同一个调用成功。(verification: packaged artifact,在 Worker 中模拟权限失效;浏览器自身的权限弹窗需要真实文件夹,由人工检查)
- AC4 — 在 WebKit 和 Firefox 中,选择器的新建文件夹操作弹出需要 Chrome 或 Edge 的提示,不登记任何内容。(verification: packaged artifact)
- AC5 — 在 Chromium、WebKit 和 Firefox 中,`LocalFolderFS` 能在目录句柄上读、写、列出、查询、重命名和删除文件,并能看到在它之外创建的文件。现有 Web Core 测试仍然通过,`src/main`、`src/preload`、`src/renderer` 和 `src/shared` 下没有文件改动。(verification: packaged artifact 和 change-scope report)

## Risks

- **仅支持 Chromium。** Firefox 和 Safari 没有 `showDirectoryPicker`,这些浏览器的用户继续使用浏览器内的工作区。
- **Agent 修改的是真实文件。** 与桌面端一样,`default` 模式下修改需要审批;但 `acceptEdits`、`auto` 和 `bypassPermissions` 模式会直接写入,而且没有撤销。
- **权限可能失效。** 只有用户选择保留,或应用已安装时,Chrome 才会在多次访问之间保留权限;否则重新加载后会再次弹出提示。
- **搜索开销。** `find` 和 `grep` 通过句柄 API 遍历文件夹,比磁盘搜索慢;它们和以前一样跳过 `.git` 和 `node_modules`。
