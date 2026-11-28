# Selection icon keyboard regression

This Chromium check loads the real icon grid, Input primitive, and both main-window stylesheets. It protects the focus indicator from the global outline reset, then verifies Enter selects the focused icon. The component test keeps keyboard behavior coverage without claiming class names prove visibility.

From the repository root:

```sh
pnpm exec playwright install chromium
pnpm exec playwright test --config tests/browser/icon-focus/playwright.config.ts
```

`CHROME_EXECUTABLE` can point to an installed Chromium/Chrome executable. The test writes `keyboard-focus.png` in its Playwright output directory. Removing the grid's focus-ring utilities must fail the rendered-shadow assertion.

This is a focused browser check, not full Electron or popover-placement acceptance.
