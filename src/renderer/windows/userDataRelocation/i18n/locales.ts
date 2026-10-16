export const relocationLocales = {
  en: {
    translation: {
      relocation: {
        title: 'Data Directory Migration',
        preparing: 'Preparing migration...',
        copying: 'Copying data...',
        committing: 'Saving new data directory...',
        completed: {
          title: 'Migration complete',
          description: 'Restart Cherry Studio to use the new data directory.'
        },
        failed: {
          title: 'Migration failed',
          description: 'Cherry Studio will keep using the previous data directory.'
        },
        support: {
          analysis_unavailable:
            'Automatic analysis is unavailable. You can copy the error, send feedback, or open the official releases.',
          copy: 'Copy error',
          feedback: 'Send feedback',
          releases: 'Open releases'
        },
        restart_success: 'Restart Cherry Studio',
        restart_failure: 'Continue with Previous Directory',
        from: 'Current directory',
        to: 'New directory'
      }
    }
  },
  'zh-CN': {
    translation: {
      relocation: {
        title: '数据目录迁移',
        preparing: '正在准备迁移...',
        copying: '正在复制数据...',
        committing: '正在保存新的数据目录...',
        completed: {
          title: '迁移完成',
          description: '请重启 Cherry Studio 以使用新的数据目录。'
        },
        failed: {
          title: '迁移失败',
          description: 'Cherry Studio 将继续使用原数据目录。'
        },
        support: {
          analysis_unavailable: '自动分析不可用。你可以复制错误、发送反馈或打开官方发布页。',
          copy: '复制错误',
          feedback: '发送反馈',
          releases: '打开发布页'
        },
        restart_success: '重启 Cherry Studio',
        restart_failure: '继续使用原数据目录',
        from: '当前目录',
        to: '新目录'
      }
    }
  },
  'zh-TW': {
    translation: {
      relocation: {
        title: '資料目錄遷移',
        preparing: '正在準備遷移...',
        copying: '正在複製資料...',
        committing: '正在儲存新的資料目錄...',
        completed: {
          title: '遷移完成',
          description: '請重新啟動 Cherry Studio 以使用新的資料目錄。'
        },
        failed: {
          title: '遷移失敗',
          description: 'Cherry Studio 將繼續使用原資料目錄。'
        },
        support: {
          analysis_unavailable: '自動分析無法使用。你可以複製錯誤、傳送意見回饋或開啟官方發布頁。',
          copy: '複製錯誤',
          feedback: '傳送意見回饋',
          releases: '開啟發布頁'
        },
        restart_success: '重新啟動 Cherry Studio',
        restart_failure: '繼續使用原資料目錄',
        from: '目前目錄',
        to: '新目錄'
      }
    }
  }
} as const
