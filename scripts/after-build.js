const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

async function DeleteFilesWithSpaces() {
  const distPath = path.join('dist')
  const files = fs.readdirSync(distPath, { withFileTypes: true })
  // Only process files in the root of dist directory, not subdirectories
  files.forEach((file) => {
    if (file.isFile() && file.name.includes(' ')) {
      fs.rmSync(path.join(distPath, file.name))
      console.log(`delete: ${file.name}`)
    }
  })
}

async function afterBuild() {
  console.log('[After build] hook started...')

  try {
    // Read the latest.yml file
    const latestYmlPath = path.join('dist', 'latest.yml')
    const yamlContent = fs.readFileSync(latestYmlPath, 'utf8')
    const data = yaml.load(yamlContent)

    if (data.files) {
      data.files.forEach((file) => {
        if (file.url.includes(' ')) {
          const newName = file.url.replace(/ /g, '-')
          const newPath = path.join('dist', newName)
          const oldPath = path.join('dist', file.url)

          // Helper function to rename files and log the operation
          const renameFile = (oldPath, newPath) => {
            fs.renameSync(oldPath, newPath)
            console.log(`Renamed: ${oldPath} -> ${newPath}`)
          }

          // Rename main file and its blockmap
          renameFile(oldPath, newPath)
          renameFile(oldPath + '.blockmap', newPath + '.blockmap')

          // Handle portable version if it's a setup file
          if (file.url.includes('-setup')) {
            const newPortablePath = newPath.replace('-setup', '-portable')
            const oldPortablePath = path.join('dist', file.url.replace('-setup', '-portable'))
            renameFile(oldPortablePath, newPortablePath)
          }

          file.url = newName
        }
      })

      data.path = data.files[0].url
      data.sha512 = data.files[0].sha512
    }

    // Write back the modified YAML with specific dump options
    const newYamlContent = yaml.dump(data, {
      lineWidth: -1, // Prevent line wrapping
      quotingType: '"', // Use double quotes when needed
      forceQuotes: false, // Only quote when necessary
      noCompatMode: true, // Use new style options
      styles: {
        '!!str': 'plain' // Force plain style for strings
      }
    })

    fs.writeFileSync(latestYmlPath, newYamlContent, 'utf8')

    // Rename files with spaces
    await DeleteFilesWithSpaces()

    console.log('Successfully cleaned up latest.yml data')
  } catch (error) {
    console.error('Error processing latest.yml:', error)
    throw error
  }
}

afterBuild()
