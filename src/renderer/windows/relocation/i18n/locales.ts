/**
 * Locales for the relocation window. Kept independent of the main app's
 * i18n bundles (this window runs before the preference service exists).
 */
export const zhCN = {
  relocation: {
    title: '迁移数据目录',
    preparing: '正在准备迁移…',
    copying: '正在复制数据…',
    committing: '正在切换数据目录…',
    failed: {
      title: '迁移失败',
      description: '数据迁移未能完成，应用将保留在当前目录。'
    },
    from: '原目录',
    to: '新目录',
    restart_failure: '留在当前目录并重启'
  }
}

export const zhTW = {
  relocation: {
    title: '遷移資料目錄',
    preparing: '正在準備遷移…',
    copying: '正在複製資料…',
    committing: '正在切換資料目錄…',
    failed: {
      title: '遷移失敗',
      description: '資料遷移未能完成，應用程式將保留在目前目錄。'
    },
    from: '原目錄',
    to: '新目錄',
    restart_failure: '留在目前目錄並重新啟動'
  }
}

export const enUS = {
  relocation: {
    title: 'Relocate Data Directory',
    preparing: 'Preparing relocation…',
    copying: 'Copying data…',
    committing: 'Switching data directory…',
    failed: {
      title: 'Relocation Failed',
      description: 'The relocation could not complete. The app will stay on the current directory.'
    },
    from: 'From',
    to: 'To',
    restart_failure: 'Stay on current directory and restart'
  }
}
