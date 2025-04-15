const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

async function renameFilesWithSpaces() {
  const distPath = path.join('dist')
  const files = fs.readdirSync(distPath, { withFileTypes: true })

  // Only process files in the root of dist directory, not subdirectories
  files.forEach((file) => {
    if (file.isFile() && file.name.includes(' ')) {
      const oldPath = path.join(distPath, file.name)
      const newName = file.name.replace(/ /g, '-')
      const newPath = path.join(distPath, newName)

      fs.renameSync(oldPath, newPath)
      console.log(`Renamed: ${file.name} -> ${newName}`)
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

    // Remove the first element from files array
    if (data.files && data.files.length > 1) {
      const file = data.files.shift()

      // Remove Cherry Studio-1.2.3-setup.exe
      fs.rmSync(path.join('dist', file.url))
      fs.rmSync(path.join('dist', file.url + '.blockmap'))

      // Remove Cherry Studio-1.2.3-portable.exe
      fs.rmSync(path.join('dist', file.url.replace('-setup', '-portable')))

      // Update path and sha512 with the new first element's data
      if (data.files[0]) {
        data.path = data.files[0].url
        data.sha512 = data.files[0].sha512
      }
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
    await renameFilesWithSpaces()

    console.log('Successfully cleaned up latest.yml data')
  } catch (error) {
    console.error('Error processing latest.yml:', error)
    throw error
  }
}

afterBuild()
