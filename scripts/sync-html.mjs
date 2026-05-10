import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { appendFile, readdir, readFile, stat } from 'node:fs/promises'
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

const ENV = {
  ...parseEnvFile(path.join(process.cwd(), '.env')),
  ...parseEnvFile(path.join(process.cwd(), '.env.local')),
  ...process.env,
}

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run') || ENV.npm_config_dry_run === 'true'
const JSON_OUTPUT = args.has('--json') || ENV.npm_config_json === 'true'
const SUPABASE_URL = ENV.SUPABASE_URL
const SERVICE_ROLE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY
const OWNER_USER_ID = ENV.SUPABASE_OWNER_USER_ID
const SOURCE_DIR = path.resolve(process.cwd(), ENV.HTML_SYNC_SOURCE_DIR ?? 'html')
const BUCKET = ENV.HTML_SYNC_BUCKET ?? 'html-docs'
const ARCHIVE_MISSING = ENV.HTML_SYNC_ARCHIVE_MISSING !== 'false'
const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#0EA5E9']
const MAX_INDEX_CHARS = Number(ENV.HTML_SYNC_MAX_INDEX_CHARS ?? 200000)

const summary = {
  dryRun: DRY_RUN,
  sourceDir: SOURCE_DIR,
  bucket: BUCKET,
  scanned: 0,
  indexed: 0,
  uploaded: 0,
  unchanged: 0,
  archived: 0,
  failed: 0,
  duplicates: [],
  failures: [],
  files: [],
}

function log(message) {
  if (!JSON_OUTPUT) console.log(message)
}

function fail(message) {
  summary.failed += 1
  summary.failures.push(message)
  log(`ERROR ${message}`)
}

function hasLiveCredentials() {
  return Boolean(
    SUPABASE_URL &&
      SERVICE_ROLE_KEY &&
      OWNER_USER_ID &&
      !SUPABASE_URL.includes('your-project') &&
      SERVICE_ROLE_KEY !== 'your-service-role-key' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(OWNER_USER_ID),
  )
}

if (!existsSync(SOURCE_DIR)) {
  log(`HTML source directory does not exist: ${SOURCE_DIR}. Nothing to sync.`)
  printSummary()
  process.exit(0)
}

if (!DRY_RUN && !hasLiveCredentials()) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_OWNER_USER_ID.')
}

const supabase = hasLiveCredentials()
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)))
    } else if (/\.html?$/i.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function normalizeRelative(filePath) {
  return path.relative(SOURCE_DIR, filePath).replace(/\\/g, '/')
}

function extractTitle(html, fallback) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = match?.[1]?.replace(/\s+/g, ' ').trim()
  return title || fallback.replace(/\.html?$/i, '')
}

function estimateReadMinutes(html) {
  const text = extractPlainText(html)
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latinWords = text.replace(/[\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(chineseChars / 450 + latinWords / 220 || 1))
}

function decodeHtmlEntities(text) {
  const namedEntities = new Map([
    ['nbsp', ' '],
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', "'"],
  ])
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = String(entity).toLowerCase()
    try {
      if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16))
      if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10))
    } catch {
      return match
    }
    return namedEntities.get(lower) ?? match
  })
}

function extractPlainText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function countIndexWords(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latinWords = text.replace(/[\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length
  return chineseChars + latinWords
}

function findDuplicates(files) {
  const byRelative = new Map()
  for (const filePath of files) {
    const relative = normalizeRelative(filePath).toLowerCase()
    const group = byRelative.get(relative) ?? []
    group.push(filePath)
    byRelative.set(relative, group)
  }
  return Array.from(byRelative.entries())
    .filter(([, group]) => group.length > 1)
    .map(([relative, group]) => ({ relative, files: group }))
}

const categoryCache = new Map()

async function ensureCategory(name, order) {
  if (categoryCache.has(name)) return categoryCache.get(name)
  if (!supabase || DRY_RUN) {
    const category = {
      id: `dry-run-${name}`,
      name,
      color: COLORS[order % COLORS.length],
      sort_order: order + 1,
    }
    categoryCache.set(name, category)
    return category
  }

  const { data, error } = await supabase
    .from('categories')
    .upsert(
      {
        owner_id: OWNER_USER_ID,
        name,
        color: COLORS[order % COLORS.length],
        sort_order: order + 1,
      },
      { onConflict: 'owner_id,name' },
    )
    .select('*')
    .single()

  if (error) throw error
  categoryCache.set(name, data)
  return data
}

async function getExistingDocument(storagePath) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('documents')
    .select('id,file_hash,imported_at,sort_order')
    .eq('owner_id', OWNER_USER_ID)
    .eq('storage_path', storagePath)
    .maybeSingle()
  if (error) throw error
  return data
}

async function syncFile(filePath, index) {
  const relativePath = normalizeRelative(filePath)
  const storagePath = `${OWNER_USER_ID ?? 'dry-run-user'}/${relativePath}`
  const buffer = await readFile(filePath)
  const html = buffer.toString('utf8')
  const fileStat = await stat(filePath)
  const fileHash = hash(buffer)
  const contentText = extractPlainText(html).slice(0, MAX_INDEX_CHARS)
  const wordCount = countIndexWords(contentText)
  const parts = relativePath.split('/')
  const categoryName = parts.length > 1 ? parts[0] : '未分类'
  const category = await ensureCategory(categoryName, index)
  const existing = await getExistingDocument(storagePath)
  const unchanged = Boolean(existing?.file_hash && existing.file_hash === fileHash)

  const plan = {
    relativePath,
    storagePath,
    title: extractTitle(html, path.basename(relativePath)),
    hash: fileHash,
    wordCount,
    indexed: contentText.length > 0,
    status: unchanged ? 'unchanged' : existing ? 'updated' : 'uploaded',
  }
  summary.files.push(plan)
  if (plan.indexed) summary.indexed += 1

  if (unchanged) {
    summary.unchanged += 1
    log(`Unchanged ${relativePath} (${wordCount} indexed words)`)
    return storagePath
  }

  if (DRY_RUN) {
    summary.uploaded += 1
    log(`DRY-RUN ${existing ? 'would update' : 'would upload'} ${relativePath} -> ${storagePath} (${wordCount} indexed words)`)
    return storagePath
  }

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    upsert: true,
    contentType: 'text/html',
  })
  if (uploadError) throw uploadError

  const record = {
    owner_id: OWNER_USER_ID,
    category_id: category.id,
    title: plan.title,
    storage_path: storagePath,
    file_hash: fileHash,
    source_modified_at: fileStat.mtime.toISOString(),
    archived: false,
    reading_estimate_minutes: estimateReadMinutes(html),
    content_text: contentText,
    word_count: wordCount,
    indexed_at: new Date().toISOString(),
    metadata: {
      relative_path: relativePath,
      bytes: buffer.byteLength,
    },
  }

  if (!existing?.imported_at) {
    record.imported_at = new Date().toISOString()
    record.sort_order = (index + 1) * 1000
  }

  const { error: upsertError } = await supabase.from('documents').upsert(record, { onConflict: 'owner_id,storage_path' })
  if (upsertError) throw upsertError

  summary.uploaded += 1
  log(`Synced ${relativePath} -> ${storagePath} (${wordCount} indexed words)`)
  return storagePath
}

async function archiveMissing(activeStoragePaths) {
  if (!ARCHIVE_MISSING || !supabase) return 0

  const { data, error } = await supabase
    .from('documents')
    .select('id,storage_path')
    .eq('owner_id', OWNER_USER_ID)
    .eq('archived', false)

  if (error) throw error

  const missing = (data ?? []).filter((document) => !activeStoragePaths.has(document.storage_path))
  if (missing.length === 0) return 0

  if (DRY_RUN) {
    for (const document of missing) log(`DRY-RUN would archive ${document.storage_path}`)
    return missing.length
  }

  const { error: archiveError } = await supabase
    .from('documents')
    .update({ archived: true })
    .in(
      'id',
      missing.map((document) => document.id),
    )

  if (archiveError) throw archiveError
  return missing.length
}

async function writeGithubSummary() {
  if (!ENV.GITHUB_STEP_SUMMARY) return
  const body = [
    '## HTML sync summary',
    '',
    `- Dry run: ${summary.dryRun ? 'yes' : 'no'}`,
    `- Scanned: ${summary.scanned}`,
    `- Indexed: ${summary.indexed}`,
    `- Uploaded/updated: ${summary.uploaded}`,
    `- Unchanged: ${summary.unchanged}`,
    `- Archived: ${summary.archived}`,
    `- Failed: ${summary.failed}`,
    '',
  ]

  if (summary.failures.length) {
    body.push('### Failures', '', ...summary.failures.map((item) => `- ${item}`), '')
  }
  if (summary.duplicates.length) {
    body.push('### Duplicates', '', ...summary.duplicates.map((item) => `- ${item.relative}: ${item.files.length} files`), '')
  }
  await appendFile(ENV.GITHUB_STEP_SUMMARY, `${body.join('\n')}\n`)
}

async function printSummary() {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  log('')
  log('HTML sync summary')
  log(`Dry run: ${summary.dryRun ? 'yes' : 'no'}`)
  log(`Scanned: ${summary.scanned}`)
  log(`Indexed: ${summary.indexed}`)
  log(`Uploaded/updated: ${summary.uploaded}`)
  log(`Unchanged: ${summary.unchanged}`)
  log(`Archived: ${summary.archived}`)
  log(`Failed: ${summary.failed}`)
  if (summary.duplicates.length) log(`Duplicates: ${summary.duplicates.length}`)
}

const files = await walk(SOURCE_DIR)
summary.scanned = files.length
summary.duplicates = findDuplicates(files)
for (const duplicate of summary.duplicates) {
  log(`Duplicate relative path detected: ${duplicate.relative}`)
}

const activeStoragePaths = new Set()

for (const [index, filePath] of files.entries()) {
  try {
    const storagePath = await syncFile(filePath, index)
    activeStoragePaths.add(storagePath)
  } catch (error) {
    fail(`${normalizeRelative(filePath)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

try {
  summary.archived = await archiveMissing(activeStoragePaths)
} catch (error) {
  fail(`archive missing: ${error instanceof Error ? error.message : String(error)}`)
}

await writeGithubSummary()
await printSummary()

if (summary.failed > 0) {
  process.exitCode = 1
}
