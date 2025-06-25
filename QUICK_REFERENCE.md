# Quick Reference - Project State 2025-01-27

## 🚦 Current Status: STABLE ✅

**Branch**: `main` (clean, no Firebase/Supabase)  
**Last Commit**: `c3819cb5e` - Settings navigation fixed

## 🏃 To Start Working:

```bash
git status          # Check you're on main
npm run dev         # Start dev server
```

## ✅ What Works:

- Settings navigation (Provider → Model → General etc.)
- Tab system with singleton routes
- Keyboard shortcut Cmd+, for settings

## ⚠️ What Needs Fixing:

- Inputbar buttons still use `navigate()` instead of tab system
- MCP Settings components need same fix

## 🔧 The Fix Pattern:

```typescript
// ❌ OLD - Don't use this
navigate('/settings/provider')

// ✅ NEW - Use this instead
dispatch(
  openTab({
    type: 'page',
    route: '/settings/provider',
    title: 'Settings',
    canClose: true,
    isPinned: false
  })
)
```

## 📦 Git Branches:

- `main` - Your clean working branch ✅
- `old-main-with-firebase` - Backup with Firebase mess ⚠️
- `try1` - Same as main, can delete

## 🏷️ Recovery Points:

- Tag: `stable-2025-01-27-settings-fixed`
- Command: `git checkout stable-2025-01-27-settings-fixed`

## 📤 When Ready to Push:

```bash
git push --force-with-lease origin main
```

⚠️ This WILL overwrite remote!

---

_See CURRENT_STATE_2025-01-27.md for full details_
