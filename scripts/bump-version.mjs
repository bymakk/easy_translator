import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const statePath = join(root, 'version-state.json')
const manifestPath = join(root, 'chrome-extension', 'manifest.json')
const pkgPath = join(root, 'package.json')

const state = JSON.parse(readFileSync(statePath, 'utf8'))
const build = Number(state.build ?? 0) + 1
state.build = build
writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8')

const versionName = (build / 100).toFixed(2)
const chromeVersion =
  build <= 65535 ? `0.0.${build}` : `${Math.floor(build / 65535)}.${build % 65535}.0`

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.version = chromeVersion
manifest.version_name = versionName
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = chromeVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

console.log(`[bump-version] build=${build} → manifest ${chromeVersion} (${versionName}), package.json ${chromeVersion}`)
