import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const asJson = args.has('--json')
const soft = args.has('--soft')
const root = process.cwd()

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const values = {}
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    values[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }

  return values
}

const fileEnv = {
  ...parseEnvFile(path.join(root, '.env')),
  ...parseEnvFile(path.join(root, '.env.local')),
}
const env = { ...fileEnv, ...process.env }

function has(name) {
  return Boolean(String(env[name] ?? '').trim())
}

function isUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

const checks = []

function check(id, label, status, detail) {
  checks.push({ id, label, status, detail })
}

check(
  'env-file',
  '.env.local',
  existsSync(path.join(root, '.env.local')) ? 'pass' : 'warn',
  existsSync(path.join(root, '.env.local'))
    ? '.env.local exists.'
    : '.env.local is missing. Copy .env.example to .env.local for local live testing.',
)

check(
  'demo-mode',
  'VITE_DEMO_MODE',
  env.VITE_DEMO_MODE === 'true' ? 'warn' : 'pass',
  env.VITE_DEMO_MODE === 'true' ? 'Demo mode is enabled. Disable it for production.' : 'Demo mode is not enabled.',
)

check(
  'supabase-url',
  'VITE_SUPABASE_URL',
  has('VITE_SUPABASE_URL') && isUrl(env.VITE_SUPABASE_URL) ? 'pass' : 'fail',
  has('VITE_SUPABASE_URL') ? 'Frontend Supabase URL is present.' : 'Missing frontend Supabase URL.',
)

check(
  'supabase-anon',
  'VITE_SUPABASE_ANON_KEY',
  has('VITE_SUPABASE_ANON_KEY') ? 'pass' : 'fail',
  has('VITE_SUPABASE_ANON_KEY') ? 'Frontend anon key is present.' : 'Missing frontend anon key.',
)

check(
  'sync-url',
  'SUPABASE_URL',
  has('SUPABASE_URL') && isUrl(env.SUPABASE_URL) ? 'pass' : 'fail',
  has('SUPABASE_URL') ? 'Sync Supabase URL is present.' : 'Missing sync Supabase URL.',
)

check(
  'sync-service-role',
  'SUPABASE_SERVICE_ROLE_KEY',
  has('SUPABASE_SERVICE_ROLE_KEY') ? 'pass' : 'fail',
  has('SUPABASE_SERVICE_ROLE_KEY') ? 'Service role key is present in local/CI env.' : 'Missing service role key for trusted sync jobs.',
)

check(
  'sync-owner',
  'SUPABASE_OWNER_USER_ID',
  has('SUPABASE_OWNER_USER_ID') && isUuid(env.SUPABASE_OWNER_USER_ID) ? 'pass' : 'fail',
  has('SUPABASE_OWNER_USER_ID') ? 'Owner user id is present.' : 'Missing owner user id.',
)

const sourceDir = path.resolve(root, env.HTML_SYNC_SOURCE_DIR || 'html')
check(
  'sync-source',
  'HTML source directory',
  existsSync(sourceDir) ? 'pass' : 'warn',
  existsSync(sourceDir) ? `HTML source exists: ${sourceDir}` : `HTML source directory is missing: ${sourceDir}`,
)

check(
  'ai-base-url',
  'AI_BASE_URL',
  !has('AI_BASE_URL') || isUrl(env.AI_BASE_URL) ? 'pass' : 'fail',
  has('AI_BASE_URL') ? 'AI base URL looks valid.' : 'AI_BASE_URL is optional locally but required before deploying Edge Functions.',
)

check(
  'ai-key',
  'AI_API_KEY',
  has('AI_API_KEY') ? 'pass' : 'warn',
  has('AI_API_KEY') ? 'AI API key is present in local/CI env.' : 'AI API key is missing; Edge Functions will fail until a secret is set.',
)

for (const workflow of ['.github/workflows/deploy-pages.yml', '.github/workflows/deploy-supabase.yml', '.github/workflows/ci.yml']) {
  check(
    `workflow-${workflow}`,
    workflow,
    existsSync(path.join(root, workflow)) ? 'pass' : 'fail',
    existsSync(path.join(root, workflow)) ? 'Workflow exists.' : 'Workflow is missing.',
  )
}

for (const templateFile of [
  'templates/content-repo/package.json',
  'templates/content-repo/.github/workflows/sync-html.yml',
  'templates/content-repo/scripts/content-preflight.mjs',
]) {
  check(
    `content-template-${templateFile}`,
    templateFile,
    existsSync(path.join(root, templateFile)) ? 'pass' : 'fail',
    existsSync(path.join(root, templateFile)) ? 'Private content repo template exists.' : 'Private content repo template file is missing.',
  )
}

const gitignore = existsSync(path.join(root, '.gitignore')) ? readFileSync(path.join(root, '.gitignore'), 'utf8') : ''
check(
  'html-gitignore',
  'Private HTML gitignore',
  gitignore.includes('html/**/*.html') ? 'pass' : 'fail',
  gitignore.includes('html/**/*.html') ? 'Real HTML files are ignored in this public repo.' : 'html/**/*.html is not ignored.',
)

const summary = {
  generatedAt: new Date().toISOString(),
  pass: checks.filter((item) => item.status === 'pass').length,
  warn: checks.filter((item) => item.status === 'warn').length,
  fail: checks.filter((item) => item.status === 'fail').length,
  checks,
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log('HTML Vault preflight')
  console.log(`Generated: ${summary.generatedAt}`)
  console.log(`Pass: ${summary.pass}  Warn: ${summary.warn}  Fail: ${summary.fail}`)
  console.log('')
  for (const item of checks) {
    const mark = item.status === 'pass' ? 'PASS' : item.status === 'warn' ? 'WARN' : 'FAIL'
    console.log(`[${mark}] ${item.label}: ${item.detail}`)
  }
}

if (!soft && summary.fail > 0) {
  process.exitCode = 1
}
