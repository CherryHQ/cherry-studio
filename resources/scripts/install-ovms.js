const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const { downloadWithPowerShell } = require('./download')

// Base URL for downloading OVMS binaries
const OVMS_RELEASE_BASE_URL =
  'https://storage.openvinotoolkit.org/repositories/openvino_model_server/packages/2025.3.0/ovms_windows_python_on.zip'
const OVMS_EX_URL = 'https://gitcode.com/gcw_ggDjjkY3/kjfile/releases/download/download/ovms_25.3_ex.zip'

/**
 * error code:
 * 101: Unsupported CPU (not Intel)
 * 102: Unsupported platform (not Windows)
 * 103: Download failed
 * 104: Installation failed
 * 105: Failed to create ovdnd.exe
 * 106: Failed to create run.bat
 * 110: Cleanup of old installation failed
 */

/**
 * Clean old OVMS installation if it exists
 */
function cleanOldOvmsInstallation() {
  console.log('Cleaning the existing OVMS installation...')
  const csDir = path.join(os.homedir(), '.cherrystudio')
  const csOvmsDir = path.join(csDir, 'ovms')
  if (fs.existsSync(csOvmsDir)) {
    try {
      fs.rmSync(csOvmsDir, { recursive: true })
    } catch (error) {
      console.warn(`Failed to clean up old OVMS installation: ${error.message}`)
      return 110
    }
  }

  return 0
}

/**
 * Install OVMS Base package
 */
async function installOvmsBase() {
  // Download the base package
  const tempdir = os.tmpdir()
  const tempFilename = path.join(tempdir, 'ovms.zip')

  try {
    console.log(`Downloading OVMS Base Package from ${OVMS_RELEASE_BASE_URL} to ${tempFilename}...`)

    // Try PowerShell download first, fallback to Node.js download if it fails
    await downloadWithPowerShell(OVMS_RELEASE_BASE_URL, tempFilename)
    console.log(`Successfully downloaded from: ${OVMS_RELEASE_BASE_URL}`)
  } catch (error) {
    console.error(`Download OVMS Base failed: ${error.message}`)
    fs.unlinkSync(tempFilename)
    return 103
  }

  // unzip the base package to the target directory
  const csDir = path.join(os.homedir(), '.cherrystudio')
  const csOvmsDir = path.join(csDir, 'ovms')
  fs.mkdirSync(csOvmsDir, { recursive: true })

  try {
    // Use tar.exe to extract the ZIP file
    console.log(`Extracting OVMS Base to ${csOvmsDir}...`)
    execSync(`tar -xf ${tempFilename} -C ${csOvmsDir}`, { stdio: 'inherit' })
    console.log(`OVMS extracted to ${csOvmsDir}`)

    // Clean up temporary file
    fs.unlinkSync(tempFilename)
    console.log(`Installation directory: ${csDir}`)
  } catch (error) {
    console.error(`Error installing OVMS: ${error.message}`)
    fs.unlinkSync(tempFilename)
    return 104
  }

  const csOvmsBinDir = path.join(csOvmsDir, 'ovms')
  // copy ovms.exe to ovdnd.exe
  try {
    fs.copyFileSync(path.join(csOvmsBinDir, 'ovms.exe'), path.join(csOvmsBinDir, 'ovdnd.exe'))
    console.log('Copied ovms.exe to ovdnd.exe')
  } catch (error) {
    console.error(`Error copying ovms.exe to ovdnd.exe: ${error.message}`)
    return 105
  }

  // copy {csOvmsBinDir}/setupvars.bat to {csOvmsBinDir}/run.bat, and append the following lines to run.bat:
  // del %USERPROFILE%\.cherrystudio\ovms_log.log
  // ovms.exe --config_path models/config.json --rest_port 8000 --log_level DEBUG --log_path %USERPROFILE%\.cherrystudio\ovms_log.log
  const runBatPath = path.join(csOvmsBinDir, 'run.bat')
  try {
    fs.copyFileSync(path.join(csOvmsBinDir, 'setupvars.bat'), runBatPath)
    fs.appendFileSync(runBatPath, '\r\n')
    fs.appendFileSync(runBatPath, 'del %USERPROFILE%\\.cherrystudio\\ovms_log.log\r\n')
    fs.appendFileSync(
      runBatPath,
      'ovms.exe --config_path models/config.json --rest_port 8000 --log_level DEBUG --log_path %USERPROFILE%\\.cherrystudio\\ovms_log.log\r\n'
    )
    console.log(`Created run.bat at: ${runBatPath}`)
  } catch (error) {
    console.error(`Error creating run.bat: ${error.message}`)
    return 106
  }

  // create {csOvmsBinDir}/models/config.json with content '{"model_config_list": []}'
  const configJsonPath = path.join(csOvmsBinDir, 'models', 'config.json')
  fs.mkdirSync(path.dirname(configJsonPath), { recursive: true })
  fs.writeFileSync(configJsonPath, '{"mediapipe_config_list":[],"model_config_list":[]}')
  console.log(`Created config file: ${configJsonPath}`)

  return 0
}

/**
 * Install OVMS Extra package
 */
async function installOvmsExtra() {
  // Download the extra package
  const tempdir = os.tmpdir()
  const tempFilename = path.join(tempdir, 'ovms_ex.zip')

  try {
    console.log(`Downloading OVMS Extra Package from ${OVMS_EX_URL} to ${tempFilename}...`)

    // Try PowerShell download first, fallback to Node.js download if it fails
    await downloadWithPowerShell(OVMS_EX_URL, tempFilename)
    console.log(`Successfully downloaded from: ${OVMS_EX_URL}`)
  } catch (error) {
    console.error(`Download OVMS Extra failed: ${error.message}`)
    fs.unlinkSync(tempFilename)
    return 103
  }

  // unzip the extra package to the target directory
  const csDir = path.join(os.homedir(), '.cherrystudio')
  const csOvmsDir = path.join(csDir, 'ovms')

  try {
    // Use tar.exe to extract the ZIP file
    console.log(`Extracting OVMS Extra to ${csOvmsDir}...`)
    execSync(`tar -xf ${tempFilename} -C ${csOvmsDir}`, { stdio: 'inherit' })
    console.log(`OVMS extracted to ${csOvmsDir}`)

    // Clean up temporary file
    fs.unlinkSync(tempFilename)
    console.log(`Installation directory: ${csDir}`)
  } catch (error) {
    console.error(`Error installing OVMS Extra: ${error.message}`)
    fs.unlinkSync(tempFilename)
    return 104
  }

  // apply ovms patch, copy all files in {csOvmsDir}/patch/ovms to {csOvmsDir}/ovms with overwrite mode
  const patchDir = path.join(csOvmsDir, 'patch', 'ovms')
  const csOvmsBinDir = path.join(csOvmsDir, 'ovms')
  try {
    const files = fs.readdirSync(patchDir)
    files.forEach((file) => {
      const srcPath = path.join(patchDir, file)
      const destPath = path.join(csOvmsBinDir, file)
      fs.copyFileSync(srcPath, destPath)
      console.log(`Applied patch file: ${file}`)
    })
  } catch (error) {
    console.error(`Error applying OVMS patch: ${error.message}`)
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
  if (!cpuName.toLowerCase().includes('intel')) {
    console.error('OVMS installation requires an Intel CPU.')
    return 101
  }

  // only support windows
  if (platform !== 'win32') {
    console.error('OVMS installation is only supported on Windows.')
    return 102
  }

  // Clean old installation if it exists
  const cleanupCode = cleanOldOvmsInstallation()
  if (cleanupCode !== 0) {
    console.error(`OVMS cleanup failed with code: ${cleanupCode}`)
    return cleanupCode
  }

  const installBaseCode = await installOvmsBase()
  if (installBaseCode !== 0) {
    console.error(`OVMS Base installation failed with code: ${installBaseCode}`)
    cleanOldOvmsInstallation()
    return installBaseCode
  }

  const installExtraCode = await installOvmsExtra()
  if (installExtraCode !== 0) {
    console.error(`OVMS Extra installation failed with code: ${installExtraCode}`)
    return installExtraCode
  }

  return 0
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
