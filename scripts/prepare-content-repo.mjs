import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const [, , rawTarget] = process.argv
const targetDir = path.resolve(root, rawTarget ?? '../html-vault-content')
const templateDir = path.join(root, 'templates', 'content-repo')
const syncScriptPath = path.join(root, 'scripts', 'sync-html.mjs')

const files = [
  '.env.example',
  '.gitignore',
  'README.md',
  'package.json',
  '.github/workflows/sync-html.yml',
  'scripts/content-preflight.mjs',
  'html/.gitkeep',
]

function assertInsideReasonableTarget(target) {
  const parsed = path.parse(target)
  if (target === parsed.root) {
    throw new Error(`Refusing to write to filesystem root: ${target}`)
  }
  if (target === root) {
    throw new Error('Refusing to scaffold the content repository on top of the frontend repository.')
  }
}

async function copyFileFromTemplate(relativePath) {
  const source = path.join(templateDir, relativePath)
  const destination = path.join(targetDir, relativePath)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, await readFile(source))
}

async function main() {
  assertInsideReasonableTarget(targetDir)

  const force = process.argv.includes('--force')
  if (existsSync(targetDir)) {
    if (!force) {
      throw new Error(`Target already exists: ${targetDir}. Pass --force to recreate it.`)
    }
    await rm(targetDir, { recursive: true, force: true })
  }

  for (const file of files) {
    await copyFileFromTemplate(file)
  }

  const syncDestination = path.join(targetDir, 'scripts', 'sync-html.mjs')
  await writeFile(syncDestination, await readFile(syncScriptPath))

  console.log(`Private content repository scaffolded at ${targetDir}`)
  console.log('Next steps:')
  console.log('1. cd into the scaffolded directory and run npm install to create package-lock.json.')
  console.log('2. Initialize a private GitHub repository and push this directory.')
  console.log('3. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_OWNER_USER_ID as repository secrets.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
