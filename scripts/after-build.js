const fs = require('fs')

exports.default = function (buildResult) {
  try {
    console.log('[After build] rename artifact file...')
    if (!buildResult.file.includes(' ')) {
      return
    }

    let oldFilePath = buildResult.file
    if (oldFilePath.includes('-portable') && !oldFilePath.includes('-x64') && !oldFilePath.includes('-arm64')) {
      console.log('[After build] delete portable file:', oldFilePath)
      fs.unlinkSync(oldFilePath)
      return
    }
    const newfilePath = oldFilePath.replace(/ /g, '-')
    fs.renameSync(oldFilePath, newfilePath)
    buildResult.file = newfilePath
    console.log(`[After build] rename file ${oldFilePath} to ${newfilePath} `)
  } catch (error) {
    console.error('Error renaming file:', error)
  }
}
