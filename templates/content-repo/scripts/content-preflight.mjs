import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

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

const root = process.cwd()
const env = {
  ...parseEnvFile(path.join(root, '.env')),
  ...parseEnvFile(path.join(root, '.env.local')),
  ...process.env,
}
const sourceDir = path.resolve(process.cwd(), env.HTML_SYNC_SOURCE_DIR || 'html')
const checks = []

function check(label, pass, detail) {
  checks.push({ label, pass, detail })
}

function has(name) {
  return Boolean(String(env[name] ?? '').trim())
}

function isUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.hostname.includes('your-project')
  } catch {
    return false
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

check('SUPABASE_URL', has('SUPABASE_URL') && isUrl(env.SUPABASE_URL), 'Required for trusted HTML sync.')
check(
  'SUPABASE_SERVICE_ROLE_KEY',
  has('SUPABASE_SERVICE_ROLE_KEY') && env.SUPABASE_SERVICE_ROLE_KEY !== 'your-service-role-key',
  'Required for trusted HTML sync.',
)
check(
  'SUPABASE_OWNER_USER_ID',
  has('SUPABASE_OWNER_USER_ID') && isUuid(env.SUPABASE_OWNER_USER_ID),
  'Must be the manually created Supabase Auth user UUID.',
)
check('HTML source directory', existsSync(sourceDir), `Expected at ${sourceDir}.`)
check('HTML_SYNC_BUCKET', (env.HTML_SYNC_BUCKET || 'html-docs') === 'html-docs', 'Expected private bucket html-docs.')

console.log('HTML content repo preflight')
for (const item of checks) {
  console.log(`[${item.pass ? 'PASS' : 'FAIL'}] ${item.label}: ${item.detail}`)
}

if (checks.some((item) => !item.pass)) {
  process.exitCode = 1
}
