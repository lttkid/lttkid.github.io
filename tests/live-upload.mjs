import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const root = process.cwd()
const baseUrl = process.env.LIVE_UPLOAD_BASE_URL ?? 'http://127.0.0.1:4177/'
let serverProcess = null

function stopServer() {
  if (!serverProcess?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(serverProcess.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    serverProcess.kill()
  }
  serverProcess = null
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const values = {}
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

const env = { ...parseEnvFile(path.join(root, '.env')), ...parseEnvFile(path.join(root, '.env.local')), ...process.env }

function firstValue(...names) {
  for (const name of names) {
    const value = String(env[name] ?? '').trim()
    if (value && !/^(your-|replace-with-|https:\/\/your-project\.supabase\.co$)/i.test(value)) return value
  }
  return ''
}

const supabaseUrl = firstValue('VITE_SUPABASE_URL', 'SUPABASE_URL')
const supabaseAnonKey = firstValue('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY')
const testEmail = firstValue('LIVE_TEST_EMAIL', 'SUPABASE_OWNER_EMAIL', 'TEST_USER_EMAIL', 'E2E_EMAIL')
const testPassword = firstValue('LIVE_TEST_PASSWORD', 'SUPABASE_OWNER_PASSWORD', 'TEST_USER_PASSWORD', 'E2E_PASSWORD')

function assert(value, message) {
  if (!value) throw new Error(message)
}

for (const [name, value] of [
  ['VITE_SUPABASE_URL', supabaseUrl],
  ['VITE_SUPABASE_ANON_KEY', supabaseAnonKey],
  ['LIVE_TEST_EMAIL', testEmail],
  ['LIVE_TEST_PASSWORD', testPassword],
]) {
  if (!value) throw new Error(`Missing ${name}. Set it in .env.local or shell environment.`)
}

async function isReachable(url) {
  try {
    return (await fetch(url)).ok
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
  serverProcess = spawn('npm', ['run', 'dev', '--', '--host', parsed.hostname, '--port', parsed.port || '4177'], {
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

const client = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const runId = Date.now().toString(36)
const title = `Live Upload Smoke ${runId}`
const phrase = `upload-search-token-${runId}`
const longBody = Array.from({ length: 36 }, (_, index) => `<p>第 ${index + 1} 段：${phrase} 用于验证上传正文索引、阅读滚动和断点续读。</p>`).join('')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:sans-serif;line-height:1.7}main{max-width:760px;margin:auto}.spacer{height:900px}</style></head><body><main><h1>${title}</h1><p>${phrase}</p>${longBody}<div class="spacer">尾部滚动验证区域</div></main></body></html>`
const uploadPath = path.join(os.tmpdir(), `${title.replace(/\s+/g, '-')}.html`)
writeFileSync(uploadPath, html)

async function cleanup() {
  const { data: documents } = await client.from('documents').select('id,storage_path').eq('title', title)
  for (const document of documents ?? []) {
    await client.storage.from('html-docs').remove([document.storage_path])
    await client.from('documents').delete().eq('id', document.id)
  }
}

async function waitForCondition(check, message, timeoutMs = 15000) {
  const started = Date.now()
  let lastValue
  while (Date.now() - started < timeoutMs) {
    lastValue = await check()
    if (lastValue) return lastValue
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(message)
}

async function queryUploadedDocument() {
  const { data, error } = await client
    .from('documents')
    .select('id,title,owner_id,storage_path,file_hash,content_text,archived,last_read_at,last_scroll,metadata')
    .eq('title', title)
  if (error) throw error
  if (data?.length !== 1) return null
  return data[0]
}

async function queryLatestReadingSession(documentId) {
  const { data, error } = await client
    .from('reading_sessions')
    .select('id,document_id,duration_seconds,last_scroll,ended_at,started_at')
    .eq('document_id', documentId)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

async function setFrameScroll(frame, progress) {
  await frame.locator('body').evaluate((body, target) => {
    const root = body.ownerDocument.scrollingElement || body.ownerDocument.documentElement
    const max = Math.max(1, root.scrollHeight - root.clientHeight)
    root.scrollTop = max * target
  }, progress)
}

async function getFrameScroll(frame) {
  return frame.locator('body').evaluate((body) => {
    const root = body.ownerDocument.scrollingElement || body.ownerDocument.documentElement
    const max = Math.max(1, root.scrollHeight - root.clientHeight)
    return root.scrollTop / max
  })
}

async function signInIfNeeded(page) {
  const loginVisible = await page
    .getByLabel('邮箱')
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false)

  if (!loginVisible) {
    await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor({ timeout: 20000 })
    return
  }

  await page.getByLabel('邮箱').fill(testEmail)
  await page.getByLabel('密码').fill(testPassword)
  await page.getByRole('button', { name: '登录' }).click()
}

try {
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  })
  if (authError) throw authError
  assert(authData.user, 'Login did not return a user.')

  await cleanup()
  await ensureServer()

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await page.goto(baseUrl, { waitUntil: 'load' })
    await signInIfNeeded(page)
    await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor({ timeout: 20000 })

    await page.getByRole('button', { name: '上传 HTML' }).click()
    await page.getByLabel('HTML 文件').setInputFiles(uploadPath)
    await page.getByRole('button', { name: '上传 1 个文件' }).click()
    await page.getByText('已写入资料库，正文搜索已可用。').waitFor({ timeout: 30000 })

    await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill(phrase)
    await page.getByRole('heading', { name: title }).waitFor({ timeout: 20000 })

    const uploadedDocument = await waitForCondition(
      queryUploadedDocument,
      'Uploaded document was not found in Supabase after UI upload.',
    )
    assert(uploadedDocument.metadata?.source === 'browser_upload', 'Uploaded document metadata source is not browser_upload.')

    const uploadedCard = page.locator('.document-card').filter({ hasText: title }).first()
    await uploadedCard.locator('.source-badge', { hasText: '前端上传' }).waitFor({ timeout: 10000 })
    await uploadedCard.getByRole('button', { name: '阅读' }).click()
    await page.locator('iframe').waitFor({ state: 'visible', timeout: 20000 })

    const frame = page.frameLocator('iframe')
    await frame.locator('h1').waitFor({ timeout: 10000 })
    assert((await frame.locator('h1').innerText()) === title, 'Uploaded document did not render in the reader.')

    await setFrameScroll(frame, 0.68)
    await page.waitForTimeout(700)
    const scrolledProgress = await getFrameScroll(frame)
    assert(scrolledProgress > 0.45, `Reader did not scroll far enough for resume verification: ${scrolledProgress}.`)

    await page.getByRole('button', { name: '返回资料库' }).click()
    await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor({ timeout: 10000 })

    const progressedDocument = await waitForCondition(
      async () => {
        const document = await queryUploadedDocument()
        return document?.last_read_at && Number(document.last_scroll) > 0.45 ? document : null
      },
      'Uploaded document last_read_at/last_scroll was not persisted.',
    )
    assert(progressedDocument.last_read_at, 'Uploaded document last_read_at was not persisted.')

    const reportedSession = await waitForCondition(
      async () => {
        const session = await queryLatestReadingSession(uploadedDocument.id)
        return session?.ended_at && Number(session.last_scroll) > 0.45 ? session : null
      },
      'Reading session was not reported for the uploaded document.',
    )
    assert(reportedSession.document_id === uploadedDocument.id, 'Reading session points to the wrong document.')

    await page.getByRole('button', { name: '统计' }).click()
    await page.getByRole('heading', { name: '阅读统计' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: title }).waitFor({ timeout: 10000 })
  } finally {
    await page.close()
    await browser.close()
  }

  const document = await queryUploadedDocument()
  assert(document, 'Expected one uploaded document after browser verification.')
  assert(document.owner_id === authData.user.id, 'Uploaded document owner_id does not match the current user.')
  assert(document.storage_path.startsWith(`${authData.user.id}/uploads/`), 'Uploaded Storage path does not start with the current user id.')
  assert(document.content_text?.includes(phrase), 'Uploaded document content_text does not include the body phrase.')
  assert(document.file_hash === createHash('sha256').update(html).digest('hex'), 'Uploaded file hash does not match SHA-256.')

  const { data: blob, error: storageError } = await client.storage.from('html-docs').download(document.storage_path)
  if (storageError) throw storageError
  assert((await blob.text()).includes(title), 'Uploaded Storage object did not contain the HTML title.')

  console.log(
    JSON.stringify(
      {
        uploaded: true,
        documentId: document.id,
        title,
        storagePath: document.storage_path,
        ownerMatches: document.owner_id === authData.user.id,
        contentIndexed: document.content_text?.includes(phrase),
        readerOpened: true,
        progressPersisted: Number(document.last_scroll) > 0.45,
      },
      null,
      2,
    ),
  )
} finally {
  await cleanup()
  if (serverProcess) stopServer()
}
