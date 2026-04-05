---
name: cherry-pr-test
description: Test Cherry Studio PRs by checking out the branch, launching the Electron app in debug mode, and running interactive UI tests via CDP.
---

# Cherry Studio PR Test

Automated PR testing workflow for Cherry Studio. Checks out a PR, launches
the Electron app with Chrome DevTools Protocol, connects agent-browser, and
runs interactive UI + code review tests.

## Prerequisites

- `gh` CLI installed and authenticated
- `agent-browser` installed (for CDP-based UI testing)
- `pnpm` installed with project dependencies (`pnpm install`)

## Constraints

- Always kill existing Cherry Studio processes before launching a new instance.
- Never leave debug processes running after testing completes.
- Always switch back to the default branch after testing.
- Always show the test report to the user before posting it.

## Arguments

`$ARGUMENTS` may contain:
- A PR number (e.g., `13955`)
- A PR URL (e.g., `https://github.com/CherryHQ/cherry-studio/pull/13955`)
- Keywords like "latest", "recent" to pick a recent PR
- Empty — list recent PRs and let the user choose

## Workflow

### Phase 1: Select & Checkout PR

1. If no PR number given, list recent open PRs:
   ```bash
   gh pr list --repo CherryHQ/cherry-studio --state open --limit 10 \
     --json number,title,author,createdAt,headRefName,changedFiles \
     --template '{{range .}}#{{.number}} | {{.title}} | by {{.author.login}} | files: {{.changedFiles}}
   {{end}}'
   ```
2. Ask the user to pick one (or auto-pick if "latest"/"recent").
3. View PR details to understand what changed:
   ```bash
   gh pr view <NUMBER> --json title,body,headRefName,files
   ```
4. Checkout the PR branch:
   ```bash
   gh pr checkout <NUMBER>
   ```
5. Read the key changed files to understand the scope of changes.

### Phase 2+3: Static Analysis & Launch App (parallel)

Static analysis and app launch are independent — run them in parallel to save time.

#### Static Analysis (can run while app is starting)

1. **TypeScript typecheck** (catch type errors early):
   ```bash
   pnpm typecheck 2>&1 | grep -E "error TS|exited with code"
   ```
2. **Review blocked files**: Check if the PR modifies files with
   `@deprecated` / `V2 DATA&UI REFACTORING` headers. These files are blocked
   for feature changes until v2.0.0.
3. **Scan for common issues**:
   - Hardcoded strings (should use i18n)
   - `console.log` usage (should use `loggerService`)
   - Missing type annotations on new public interfaces

Record all findings for the final report.

#### Launch App

1. **Kill any existing Cherry Studio processes** (graceful SIGTERM first):
   ```bash
   pkill -f "cherry-studio.*Electron" 2>/dev/null
   pkill -f "electron-vite" 2>/dev/null
   lsof -ti :9222 | xargs kill 2>/dev/null
   lsof -ti :5173 | xargs kill 2>/dev/null
   sleep 3
   # Escalate to SIGKILL only if processes remain
   lsof -ti :9222 | xargs kill -9 2>/dev/null
   lsof -ti :5173 | xargs kill -9 2>/dev/null
   ```

2. **Start in debug mode** (includes `--remote-debugging-port=9222`):
   ```bash
   nohup pnpm debug > /tmp/cherry-debug.log 2>&1 &
   ```

3. **Wait for startup** (typically 20-30s):
   ```bash
   for i in $(seq 1 30); do
     lsof -i :9222 2>/dev/null | grep LISTEN && break
     sleep 2
   done
   ```

### Phase 4: Connect agent-browser

1. **Connect**:
   ```bash
   agent-browser connect 9222
   ```
   If `connect` fails, fall back to websocket URL from logs:
   ```bash
   WS_URL=$(grep "DevTools listening" /tmp/cherry-debug.log | sed 's/.*ws:/ws:/')
   agent-browser --cdp "$WS_URL" navigate http://localhost:5173
   ```

2. **Verify connection and identify the main page**:
   ```bash
   agent-browser tab
   ```
   You should see the main Cherry Studio page at `http://localhost:5173/`.
   If multiple tabs are listed, use `agent-browser tab <N>` to select the main one.

3. **Handle first-launch scenarios**:
   - **V2 Data Migration Wizard**: On the v2 branch (or fresh dev data), the app
     may show a migration wizard (`/migrationV2.html`) before the main UI.
     Click through: 介绍(下一步) → 备份(我已备份，开始迁移) → 迁移(确定) → 完成(重启应用).
     After "重启应用", kill and relaunch the app (the restart button doesn't work in dev mode).
   - **Splash screen**: Wait up to 30s for the splash to dismiss.

4. **Create screenshot directory** for this PR:
   ```bash
   mkdir -p /tmp/pr-<NUMBER>
   ```
   Use this directory for all screenshots: `/tmp/pr-<NUMBER>/<descriptive-name>.png`

### Phase 5: Interactive UI Testing

Based on the PR's changed files, navigate to the relevant pages and test.
Use your judgement to decide what to test — the PR description and changed files
should guide your testing strategy.

#### General Approach

1. Take a screenshot of the current state
2. Use `agent-browser snapshot -i` to discover interactive elements
3. Interact with elements (click, fill, drag, etc.)
4. Screenshot and verify the result
5. Verify state changes if relevant (via `agent-browser eval`)

#### Key Testing Points

- **UI renders correctly**: New components appear in the right place
- **Interactions work**: Toggles, inputs, buttons all function
- **State persistence**: Changes survive across page navigations
- **Theme compatibility**: Test in both light and dark modes
- **Layout modes**: If sidebar/layout is involved, test at different sizes
- **i18n**: Switch language and verify new strings appear correctly
- **Edge cases**: Boundary conditions, rapid toggling, empty states

### Phase 6: Cleanup

After testing:

1. **Kill all Cherry Studio processes** (graceful SIGTERM first):
   ```bash
   pkill -f "cherry-studio.*Electron" 2>/dev/null
   pkill -f "electron-vite" 2>/dev/null
   lsof -ti :9222 | xargs kill 2>/dev/null
   lsof -ti :5173 | xargs kill 2>/dev/null
   sleep 3
   lsof -ti :9222 | xargs kill -9 2>/dev/null
   lsof -ti :5173 | xargs kill -9 2>/dev/null
   ```

2. **Switch back to the default branch**:
   ```bash
   default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
   git checkout "${default_branch:-main}"
   ```

### Phase 7: Test Report

Generate a structured report with screenshots. Save the report as
`/tmp/pr-<NUMBER>/report.md` alongside the screenshots.

```markdown
# PR #<NUMBER> 测试报告

**PR 标题**: <title>
**作者**: @<author>
**分支**: <branch>
**修改文件数**: <count>

## 静态分析

| 检查项 | 结果 | 说明 |
|--------|------|------|
| TypeScript 类型检查 | ✅/❌ | ... |
| 受阻文件检查 | ✅/⚠️ | ... |
| console.log 使用 | ✅/❌ | ... |

## UI 测试

### <Test Case Name>
<description of what was tested and the result>
![screenshot](<filename>.png)

## 发现的问题
(if any)

## 结论
- 问题总数：N
- 建议：APPROVE / REQUEST_CHANGES / COMMENT
```

If the user requests, copy the report directory to a more accessible location
(e.g., Desktop) for sharing.

## Troubleshooting

### Port 9222 not listening after startup

The `pnpm debug` script passes `--remote-debugging-port=9222` to Electron.
If not working:
- Check logs: `tail -50 /tmp/cherry-debug.log`
- Kill by port: `lsof -ti :9222 | xargs kill -9`
- Verify electron-vite is running: `ps aux | grep electron-vite`

### agent-browser connect fails

Use direct websocket URL:
```bash
WS_URL=$(grep "DevTools listening" /tmp/cherry-debug.log | grep 9222 | sed 's/.*\(ws:\/\/[^ ]*\)/\1/')
agent-browser --cdp "$WS_URL" tab
```

### agent-browser target jumps to wrong page

Electron apps have multiple CDP targets (main window + webviews for mini-apps).
If `agent-browser` connects to a webview instead of the main page:
```bash
# List all targets
agent-browser tab
# Switch to the main page (usually tab 0, URL contains localhost:5173)
agent-browser tab 0
```
After opening/closing mini-apps, always verify you're on the right target
with `agent-browser tab`.

### V2 Data Migration Wizard

On the v2 branch, the app may show a data migration wizard on first launch.
This is **not a bug** — it's expected when dev data hasn't been migrated yet.
Click through the wizard steps, then restart the app manually (kill + relaunch).
The wizard only appears once; subsequent launches go straight to the main UI.

### App stuck on splash screen

Wait longer (up to 30s on first launch). The app needs to:
- Build and serve renderer via Vite dev server (port 5173)
- Run database migrations
- Initialize services (MCP, etc.)

### Empty CDP target list

After connecting, if `agent-browser tab` shows only `about:blank`:
```bash
agent-browser navigate http://localhost:5173
sleep 10
agent-browser tab
```
