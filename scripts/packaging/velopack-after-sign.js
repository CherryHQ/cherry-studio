const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { findIdentity } = require('app-builder-lib/out/codeSign/macCodeSign')

exports.default = async function (context) {
  const { keychainFile } = await context.packager.codeSigningInfo.value
  const identity = await findIdentity('Developer ID Application', process.env.CSC_NAME, keychainFile)
  if (!identity) throw new Error('Velopack requires a Developer ID Application identity')
  for (const key of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (!process.env[key]) throw new Error(`Missing ${key} for Velopack notarization`)
  }
  const profile = 'cherry-velopack'
  const keychain = keychainFile ? ['--keychain', keychainFile] : []
  try {
    execFileSync(
      'xcrun',
      [
        'notarytool',
        'store-credentials',
        profile,
        '--apple-id',
        process.env.APPLE_ID,
        '--password',
        process.env.APPLE_APP_SPECIFIC_PASSWORD,
        '--team-id',
        process.env.APPLE_TEAM_ID,
        ...keychain
      ],
      { stdio: 'pipe' }
    )
  } catch {
    throw new Error('Could not store notarization credentials')
  }
  const args = JSON.parse(process.env.CHERRY_VPK_ARGS)
  args.push(
    '--packDir',
    path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`),
    '--signAppIdentity',
    identity.name,
    '--signDisableDeep',
    '--signEntitlements',
    'build/entitlements.mac.plist',
    '--notaryProfile',
    profile,
    ...keychain
  )
  execFileSync('vpk', args, { stdio: 'inherit' })
}
