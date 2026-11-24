# Agent Note: 在 Computer Use 操作中尊重使用者的全域輸入選擇

Status: implemented

[English](2026-11-15-computer-use-global-input.md) | 中文

## Problem

在 Linux 上,會移動共享指針或使用系統鍵盤的 Computer Use 操作(點擊、拖曳、捲動、輸入、按鍵)一律被以 `PERMISSION_REQUIRED` 拒絕("This Linux action moves the shared pointer or keyboard; it needs allowGlobalInput: true"),因為 `ComputerUseService` 對每個 SDK `act`/`perform` 呼叫都傳入 `allowGlobalInput: false`。這個常數位於 action spread 之後,任何呼叫端都無法覆蓋,設定頁面也沒有任何途徑更改它。因此在 Linux 上 Computer Use 只能觀察應用程式並操作其內建無障礙控件;終端機輸入、指針操作與鍵盤輸入無論使用者如何設定都不可能。

## Decision

新增布林偏好 `app.computer_use.agent_control.global_input`(預設 `false`),於 `scripts/data-classify/data/target-key-definitions.json` 中宣告並產出到偏好 schema。`ComputerUseService` 在每次 `act`/`perform` 呼叫時讀取該值,並以 `allowGlobalInput` 轉給 SDK,使使用者的選擇從下一個動作起對所有現有任務生效,無需重啟、不需更動服務狀態。Computer Use 設定頁面以開關呈現此設定,僅在桌面控制開啟時顯示,且與桌面控制開關獨立持久化。預設 `false` 保留既有行為:已安裝環境的全域輸入維持關閉,直到使用者明確開啟。

## Alternatives considered

硬編碼 `true` 會在沒有任何使用者同意的情況下靜默地給每個 agent 共享指針與鍵盤的控制權,屬於安全性倒退。將選擇綁定到逐 app 核准會把它變成身分問題,但 runtime 是按動作而非按應用程式執行此限制,對應關係將是任意的。重用 `agent_control.enabled` 會把「是否允許桌面控制」與「是否允許全域輸入」混為一談,而且該開關會停止所有任務,只想關閉全域輸入的使用者不會期待這種效果。在服務初始化時讀取一次偏好會在使用者改變設定後立即過時;每次呼叫讀取讓它保持即時,代價是每个動作多一次偏好查詢。

## Consequences

開啟開關後,在 runtime 強制此限制的平台上(SDK 文件列出 Linux 指針/鍵盤路徑),全域指針與鍵盤輸入將暴露給 agent;Wayland 環境可能仍需要 Remote Desktop portal 授權。關閉則回復嚴格行為:這類動作被阻擋,agent 仍可觀察應用程式並使用其無障礙控件。已安裝環境在使用者開啟開關前不受影響,且變更從下一個動作起生效。該值原封轉給 runtime;哪些動作真正需要它由 runtime 依平台決定。

## Verification

- Regression — `src/main/services/__tests__/ComputerUseService.control.test.ts`("sends the user global input choice to SDK act and perform calls"):SDK `act` 與 `perform` 預設收到 `allowGlobalInput: false`,偏好翻轉後收到 `true`;涵蓋 `act` 路徑與 `perform` executor 分支。
- Regression — `src/renderer/pages/settings/__tests__/ComputerUseSettings.test.tsx`("shows global input only while desktop control is on and persists the user choice"):桌面控制關閉時開關不存在,開啟後出現,點擊後持久化 `app.computer_use.agent_control.global_input`。
- Tests — `pnpm test:main` 跑 `ComputerUseService.control.test.ts`、`ComputerUseService.test.ts`、`ComputerUseService.approval.test.ts`、`ipc/handlers/__tests__/computerUse.test.ts`(32 條)與 `pnpm test:renderer` 跑 `ComputerUseSettings.test.tsx`(6 條),全部通過。
- Checks — `pnpm typecheck`(全部專案)、變更檔案的 oxlint + ESLint、`pnpm i18n:check`(115,933 條翻譯)與 `pnpm docs:check` 全部通過;新增字串已翻譯全部 16 個語系。
