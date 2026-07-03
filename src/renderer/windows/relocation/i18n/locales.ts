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
    completed: {
      title: '迁移完成',
      description: '数据已成功迁移到新目录，请重启应用以完成操作。'
    },
    failed: {
      title: '迁移失败',
      description: '数据迁移未能完成，应用将保留在当前目录。'
    },
    from: '原目录',
    to: '新目录',
    restart: '重启应用',
    restart_failure: '留在当前目录并重启'
  }
}

export const enUS = {
  relocation: {
    title: 'Relocate Data Directory',
    preparing: 'Preparing relocation…',
    copying: 'Copying data…',
    committing: 'Switching data directory…',
    completed: {
      title: 'Relocation Complete',
      description: 'Your data has been moved to the new location. Restart to finish.'
    },
    failed: {
      title: 'Relocation Failed',
      description: 'The relocation could not complete. The app will stay on the current directory.'
    },
    from: 'From',
    to: 'To',
    restart: 'Restart App',
    restart_failure: 'Stay on current directory and restart'
  }
}
