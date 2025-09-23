const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const { downloadWithPowerShell } = require('./download')

// Base URL for downloading OVMS binaries
const OVMS_PKG_NAME = 'ovms2509111.zip'
const OVMS_RELEASE_BASE_URL = [`https://gitcode.com/gcw_ggDjjkY3/kjfile/releases/download/download/${OVMS_PKG_NAME}`]

/**
 * Downloads and extracts the OVMS binary for the specified platform
 */
async function downloadOvmsBinary() {
  // Create output directory structure - OVMS goes into its own subdirectory
  const csDir = path.join(os.homedir(), '.cherrystudio')

  // Ensure directories exist
  fs.mkdirSync(csDir, { recursive: true })

  const csOvmsDir = path.join(csDir, 'ovms')
  // Delete existing OVMS directory if it exists
  if (fs.existsSync(csOvmsDir)) {
    fs.rmSync(csOvmsDir, { recursive: true })
  }

  const tempdir = os.tmpdir()
  const tempFilename = path.join(tempdir, 'ovms.zip')

  // Try each URL until one succeeds
  let downloadSuccess = false
  let lastError = null

  for (let i = 0; i < OVMS_RELEASE_BASE_URL.length; i++) {
    const downloadUrl = OVMS_RELEASE_BASE_URL[i]
    console.log(`Attempting download from URL ${i + 1}/${OVMS_RELEASE_BASE_URL.length}: ${downloadUrl}`)

    try {
      console.log(`Downloading OVMS from ${downloadUrl} to ${tempFilename}...`)

      // Try PowerShell download first, fallback to Node.js download if it fails
      await downloadWithPowerShell(downloadUrl, tempFilename)

      // If we get here, download was successful
      downloadSuccess = true
      console.log(`Successfully downloaded from: ${downloadUrl}`)
      break
    } catch (error) {
      console.warn(`Download failed from ${downloadUrl}: ${error.message}`)
      lastError = error

      // Clean up failed download file if it exists
      if (fs.existsSync(tempFilename)) {
        try {
          fs.unlinkSync(tempFilename)
        } catch (cleanupError) {
          console.warn(`Failed to clean up temporary file: ${cleanupError.message}`)
        }
      }

      // Continue to next URL if this one failed
      if (i < OVMS_RELEASE_BASE_URL.length - 1) {
        console.log(`Trying next URL...`)
      }
    }
  }

  // Check if any download succeeded
  if (!downloadSuccess) {
    console.error(`All download URLs failed. Last error: ${lastError?.message || 'Unknown error'}`)
    return 103
  }

  try {
    console.log(`Extracting to ${csDir}...`)

    // Use tar.exe to extract the ZIP file
    console.log(`Extracting OVMS to ${csDir}...`)
    execSync(`tar -xf ${tempFilename} -C ${csDir}`, { stdio: 'inherit' })
    console.log(`OVMS extracted to ${csDir}`)

    // Clean up temporary file
    fs.unlinkSync(tempFilename)
    console.log(`Installation directory: ${csDir}`)
  } catch (error) {
    console.error(`Error installing OVMS: ${error.message}`)
    if (fs.existsSync(tempFilename)) {
      fs.unlinkSync(tempFilename)
    }

    // Check if ovmsDir is empty and remove it if so
    try {
      const ovmsDir = path.join(csDir, 'ovms')
      const files = fs.readdirSync(ovmsDir)
      if (files.length === 0) {
        fs.rmSync(ovmsDir, { recursive: true })
        console.log(`Removed empty directory: ${ovmsDir}`)
      }
    } catch (cleanupError) {
      console.warn(`Warning: Failed to clean up directory: ${cleanupError.message}`)
      return 105
    }

    return 104
  }

  return 0
}

/**
 * Get the CPU Name and ID
 */
function getCpuInfo() {
  const cpuInfo = {
    name: '',
    id: ''
  }

  // Use PowerShell to get CPU information
  try {
    const psCommand = `powershell -Command "Get-CimInstance -ClassName Win32_Processor | Select-Object Name, DeviceID | ConvertTo-Json"`
    const psOutput = execSync(psCommand).toString()
    const cpuData = JSON.parse(psOutput)

    if (Array.isArray(cpuData)) {
      cpuInfo.name = cpuData[0].Name || ''
      cpuInfo.id = cpuData[0].DeviceID || ''
    } else {
      cpuInfo.name = cpuData.Name || ''
      cpuInfo.id = cpuData.DeviceID || ''
    }
  } catch (error) {
    console.error(`Failed to get CPU info: ${error.message}`)
  }

  return cpuInfo
}

/**
 * Main function to install OVMS
 */
async function installOvms() {
  const platform = os.platform()
  console.log(`Detected platform: ${platform}`)

  const cpuName = getCpuInfo().name
  console.log(`CPU Name: ${cpuName}`)

  // Check if CPU name contains "Ultra"
  if (!cpuName.toLowerCase().includes('intel') || !cpuName.toLowerCase().includes('ultra')) {
    console.error('OVMS installation requires an Intel(R) Core(TM) Ultra CPU.')
    return 101
  }

  // only support windows
  if (platform !== 'win32') {
    console.error('OVMS installation is only supported on Windows.')
    return 102
  }

  return await downloadOvmsBinary()
}

// Run the installation
installOvms()
  .then((retcode) => {
    if (retcode === 0) {
      console.log('OVMS installation successful')
    } else {
      console.error('OVMS installation failed')
    }
    process.exit(retcode)
  })
  .catch((error) => {
    console.error('OVMS installation failed:', error)
    process.exit(100)
  })
