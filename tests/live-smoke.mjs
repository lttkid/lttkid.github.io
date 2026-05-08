import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const root = process.cwd()
const baseUrl = process.env.LIVE_SMOKE_BASE_URL ?? 'http://127.0.0.1:4174/'
let serverProcess = null

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

const supabaseUrl = firstValue('VITE_SUPABASE_URL', 'SUPABASE_URL')
const supabaseAnonKey = firstValue('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY')
const testEmail = firstValue('LIVE_TEST_EMAIL', 'SUPABASE_OWNER_EMAIL', 'TEST_USER_EMAIL', 'E2E_EMAIL')
const testPassword = firstValue('LIVE_TEST_PASSWORD', 'SUPABASE_OWNER_PASSWORD', 'TEST_USER_PASSWORD', 'E2E_PASSWORD')

function firstValue(...names) {
  for (const name of names) {
    const value = String(env[name] ?? '').trim()
    if (value && !isPlaceholder(value)) return value
  }
  return ''
}

function isPlaceholder(value) {
  return /^(your-|replace-with-|reader@example\.com$|reader-password$|owner@example\.com$|https:\/\/your-project\.supabase\.co$)/i.test(
    value,
  )
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

function failMissing(name, alternatives = []) {
  const suffix = alternatives.length ? ` (or ${alternatives.join(' / ')})` : ''
  throw new Error(`Missing ${name}${suffix}. Set it in .env.local or the shell environment.`)
}

if (!supabaseUrl) failMissing('VITE_SUPABASE_URL', ['SUPABASE_URL'])
if (!supabaseAnonKey) failMissing('VITE_SUPABASE_ANON_KEY', ['SUPABASE_ANON_KEY'])
if (!testEmail) failMissing('LIVE_TEST_EMAIL', ['SUPABASE_OWNER_EMAIL', 'TEST_USER_EMAIL', 'E2E_EMAIL'])
if (!testPassword) failMissing('LIVE_TEST_PASSWORD', ['SUPABASE_OWNER_PASSWORD', 'TEST_USER_PASSWORD', 'E2E_PASSWORD'])

async function isReachable(url) {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(url) {
  const started = Date.now()
  while (Date.now() - started < 20000) {
    if (await isReachable(url)) return
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function ensureServer() {
  if (await isReachable(baseUrl)) return

  const parsed = new URL(baseUrl)
  serverProcess = spawn('npm', ['run', 'dev', '--', '--host', parsed.hostname, '--port', parsed.port || '4174'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_DEMO_MODE: 'false',
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
    },
  })
  await waitForServer(baseUrl)
}

async function checkSupabaseData() {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  })
  if (authError) throw new Error(`Supabase auth failed: ${authError.message}`)
  assert(authData.user, 'Supabase auth did not return a user.')

  const { data: documents, error: documentsError } = await client
    .from('documents')
    .select('id,title,storage_path')
    .eq('archived', false)
    .order('imported_at', { ascending: false })
    .limit(1)
  if (documentsError) throw new Error(`Documents query failed: ${documentsError.message}`)
  assert(documents?.length, 'No non-archived documents found for the live test user.')

  const { data: htmlBlob, error: storageError } = await client.storage
    .from('html-docs')
    .download(documents[0].storage_path)
  if (storageError) throw new Error(`Storage download failed: ${storageError.message}`)

  const html = await htmlBlob.text()
  assert(html.trim().length > 0, 'First document HTML is empty.')
}

async function checkBrowserFlow() {
  await ensureServer()

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  try {
    await page.goto(baseUrl, { waitUntil: 'load' })

    await page.getByLabel('邮箱').fill(testEmail)
    await page.getByLabel('密码').fill(testPassword)
    await page.getByRole('button', { name: '登录' }).click()

    await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor({ timeout: 20000 })
    await page.getByText('Supabase Secure').waitFor()

    const documentCount = await page.locator('.document-card').count()
    assert(documentCount > 0, 'The live library rendered with zero documents.')

    await page.locator('.document-card').first().getByRole('button', { name: '阅读' }).click()
    await page.locator('iframe').waitFor({ state: 'visible', timeout: 20000 })

    const readerBody = page.frameLocator('iframe').locator('body')
    await readerBody.waitFor({ timeout: 10000 })

    const bodyText = (await readerBody.innerText()).trim()
    assert(bodyText.length > 0, 'Reader iframe rendered empty HTML.')

    const readerMetrics = await page.evaluate(() => {
      const iframe = document.querySelector('iframe')?.getBoundingClientRect()
      return {
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        iframeLargeEnough: Boolean(iframe && iframe.width > 600 && iframe.height > 500),
      }
    })
    assert(readerMetrics.noHorizontalOverflow, 'Reader has horizontal overflow on desktop viewport.')
    assert(readerMetrics.iframeLargeEnough, 'Reader iframe is unexpectedly small.')

    assert(consoleErrors.length === 0, `Console errors found:\n${consoleErrors.join('\n')}`)
  } finally {
    await page.close()
    await browser.close()
  }
}

try {
  await checkSupabaseData()
  await checkBrowserFlow()
  console.log('Live smoke passed: login, library, storage download, and reader rendering are working.')
} finally {
  if (serverProcess) {
    serverProcess.kill()
  }
}
