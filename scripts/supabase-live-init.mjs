import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const asJson = args.has('--json')
const skipMigration = args.has('--skip-migration')
const root = process.cwd()
const runId = randomUUID().slice(0, 8)
const bucketName = 'html-docs'

const publicTables = [
  'categories',
  'tags',
  'documents',
  'document_tags',
  'reading_sessions',
  'highlights',
  'notes',
  'personas',
  'ai_requests',
]

const expectedStoragePolicies = [
  'read own html docs',
  'insert own html docs',
  'update own html docs',
  'delete own html docs',
]

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

function value(name) {
  return String(env[name] ?? '').trim()
}

function firstValue(...names) {
  for (const name of names) {
    const current = value(name)
    if (current) return current
  }
  return ''
}

const supabaseUrl = firstValue('SUPABASE_URL', 'VITE_SUPABASE_URL')
const anonKey = firstValue('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
const serviceRoleKey = value('SUPABASE_SERVICE_ROLE_KEY')
const ownerUserIdFromEnv = value('SUPABASE_OWNER_USER_ID')
const ownerEmail = value('SUPABASE_OWNER_EMAIL')
const ownerPassword = value('SUPABASE_OWNER_PASSWORD')
const createOwnerIfMissing = value('SUPABASE_CREATE_OWNER_IF_MISSING') === 'true'
const migrationsDir = path.join(root, 'supabase', 'migrations')

const checks = []
const cleanupTasks = []
let ownerUserId = ownerUserIdFromEnv || ''
let fatal = false
let pgClient = null

function check(id, label, status, detail, extra = {}) {
  checks.push({ id, label, status, detail, ...extra })
  if (status === 'fail') fatal = true
}

function isPlaceholder(current) {
  return !current || /^(your-|00000000-0000-0000-0000-000000000000)/i.test(current)
}

function isUuid(current) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current)
}

function safeHost(url) {
  try {
    return new URL(url).host
  } catch {
    return '(invalid url)'
  }
}

function assertReady() {
  if (fatal) {
    throw new Error('Missing or invalid Supabase live credentials.')
  }
}

function resolveDbUrl() {
  const explicit = firstValue('SUPABASE_DB_URL', 'DATABASE_URL')
  if (explicit) return explicit

  const ref = value('SUPABASE_PROJECT_REF')
  const password = value('SUPABASE_DB_PASSWORD')
  if (!ref || !password) return ''

  const encodedPassword = encodeURIComponent(password)
  return `postgresql://postgres:${encodedPassword}@db.${ref}.supabase.co:5432/postgres`
}

async function getPgClient() {
  if (pgClient) return pgClient

  const dbUrl = resolveDbUrl()
  if (!dbUrl) return null

  let Client
  try {
    ;({ Client } = await import('pg'))
  } catch {
    check('pg-dependency', 'Postgres client dependency', 'fail', 'Missing npm package "pg". Run npm install first.')
    return null
  }

  pgClient = new Client({
    connectionString: dbUrl,
    ssl: value('SUPABASE_DB_SSL') === 'false' ? false : { rejectUnauthorized: false },
  })
  await pgClient.connect()
  return pgClient
}

async function applyMigration() {
  if (skipMigration) {
    check('migration', 'SQL migration', 'skip', 'Skipped by --skip-migration.')
    return
  }

  if (!existsSync(migrationsDir)) {
    check('migration-file', 'SQL migration files', 'fail', `Missing ${migrationsDir}.`)
    return
  }

  const client = await getPgClient()
  if (!client) {
    check(
      'migration-db',
      'SQL migration',
      'fail',
      'Missing SUPABASE_DB_URL, or SUPABASE_PROJECT_REF plus SUPABASE_DB_PASSWORD, so the real database cannot be initialized.',
    )
    return
  }

  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  if (migrationFiles.length === 0) {
    check('migration-file', 'SQL migration files', 'fail', `No SQL migrations found in ${migrationsDir}.`)
    return
  }

  for (const file of migrationFiles) {
    await client.query(readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  check('migration', 'SQL migration', 'pass', `Applied ${migrationFiles.length} SQL migrations to the live database.`)
}

async function inspectRlsAndPolicies() {
  const client = await getPgClient()
  if (!client) {
    check('rls-catalog', 'RLS catalog inspection', 'skip', 'No Postgres connection available for catalog inspection.')
    return
  }

  const rlsResult = await client.query(
    `
      select c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname = any($1::text[])
      order by c.relname
    `,
    [publicTables],
  )
  const rlsByTable = new Map(rlsResult.rows.map((row) => [row.relname, row.relrowsecurity]))
  const missingTables = publicTables.filter((table) => !rlsByTable.has(table))
  const unprotectedTables = publicTables.filter((table) => rlsByTable.get(table) !== true)

  if (missingTables.length) {
    check('tables-exist', 'Public tables', 'fail', `Missing tables: ${missingTables.join(', ')}.`)
  } else {
    check('tables-exist', 'Public tables', 'pass', `Found ${publicTables.length} expected public tables.`)
  }

  if (unprotectedTables.length) {
    check('rls-enabled', 'RLS enabled', 'fail', `RLS is disabled on: ${unprotectedTables.join(', ')}.`)
  } else {
    check('rls-enabled', 'RLS enabled', 'pass', 'RLS is enabled on every expected public table.')
  }

  const policyResult = await client.query(
    `
      select tablename, policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = any($1::text[])
    `,
    [publicTables],
  )
  const policyTables = new Set(policyResult.rows.map((row) => row.tablename))
  const tablesWithoutPolicies = publicTables.filter((table) => !policyTables.has(table))
  if (tablesWithoutPolicies.length) {
    check('public-policies', 'Public RLS policies', 'fail', `Missing policies for: ${tablesWithoutPolicies.join(', ')}.`)
  } else {
    check('public-policies', 'Public RLS policies', 'pass', 'Every expected public table has an RLS policy.')
  }

  const bucketResult = await client.query(
    `
      select id, public, file_size_limit, allowed_mime_types
      from storage.buckets
      where id = $1
    `,
    [bucketName],
  )
  const bucket = bucketResult.rows[0]
  if (!bucket) {
    check('storage-bucket-catalog', 'Storage bucket catalog', 'fail', `Missing ${bucketName} bucket.`)
  } else if (bucket.public) {
    check('storage-bucket-catalog', 'Storage bucket catalog', 'fail', `${bucketName} bucket is public.`)
  } else {
    check('storage-bucket-catalog', 'Storage bucket catalog', 'pass', `${bucketName} bucket exists and is private.`)
  }

  const storagePolicyResult = await client.query(
    `
      select policyname
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = any($1::text[])
    `,
    [expectedStoragePolicies],
  )
  const actualStoragePolicies = new Set(storagePolicyResult.rows.map((row) => row.policyname))
  const missingStoragePolicies = expectedStoragePolicies.filter((policy) => !actualStoragePolicies.has(policy))
  if (missingStoragePolicies.length) {
    check(
      'storage-policies',
      'Storage RLS policies',
      'fail',
      `Missing Storage policies: ${missingStoragePolicies.join(', ')}.`,
    )
  } else {
    check('storage-policies', 'Storage RLS policies', 'pass', 'All html-docs Storage policies exist.')
  }
}

function createServiceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function createAnonClient() {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

async function findUserByEmail(serviceClient, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())
    if (found) return found
    if (data.users.length < 1000) return null
  }
  return null
}

async function resolveOwnerUser(serviceClient) {
  if (ownerUserId) {
    if (!isUuid(ownerUserId)) {
      check('owner-uuid-format', 'Owner user UUID', 'fail', 'SUPABASE_OWNER_USER_ID is not a valid UUID.')
      return null
    }

    const { data, error } = await serviceClient.auth.admin.getUserById(ownerUserId)
    if (error || !data?.user) {
      check('owner-uuid-exists', 'Owner user UUID', 'fail', `Auth user does not exist for UUID ${ownerUserId}.`)
      return null
    }
    check('owner-uuid-exists', 'Owner user UUID', 'pass', `Confirmed Auth user UUID ${ownerUserId}.`)
    return data.user
  }

  if (!ownerEmail) {
    check('owner-uuid', 'Owner user UUID', 'fail', 'Missing SUPABASE_OWNER_USER_ID or SUPABASE_OWNER_EMAIL.')
    return null
  }

  const existing = await findUserByEmail(serviceClient, ownerEmail)
  if (existing) {
    ownerUserId = existing.id
    check('owner-uuid-resolved', 'Owner user UUID', 'pass', `Resolved ${ownerEmail} to UUID ${ownerUserId}.`)
    return existing
  }

  if (!createOwnerIfMissing) {
    check(
      'owner-create',
      'Owner user UUID',
      'fail',
      `No Auth user exists for ${ownerEmail}. Set SUPABASE_CREATE_OWNER_IF_MISSING=true to create it.`,
    )
    return null
  }

  if (!ownerPassword) {
    check('owner-password', 'Owner user password', 'fail', 'SUPABASE_OWNER_PASSWORD is required to create the owner user.')
    return null
  }

  const { data, error } = await serviceClient.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
  })
  if (error || !data?.user) throw error ?? new Error('Owner user was not created.')

  ownerUserId = data.user.id
  check('owner-created', 'Owner user UUID', 'pass', `Created ${ownerEmail} with UUID ${ownerUserId}.`)
  return data.user
}

async function signIn(email, password) {
  const client = createAnonClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data?.user) throw error ?? new Error(`Could not sign in ${email}.`)
  return { client, user: data.user, email }
}

async function createTempUser(serviceClient, label) {
  const email = `html-vault-${label}-${runId}@example.com`
  const password = `HtmlVault-${runId}-${randomUUID()}-Aa1!`
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      purpose: 'html-vault-live-verification',
      run_id: runId,
    },
  })
  if (error || !data?.user) throw error ?? new Error(`Could not create temporary ${label} user.`)

  cleanupTasks.push(async () => {
    await serviceClient.auth.admin.deleteUser(data.user.id)
  })

  return signIn(email, password)
}

async function getPrimarySession(serviceClient) {
  if (ownerEmail && ownerPassword) {
    const session = await signIn(ownerEmail, ownerPassword)
    if (ownerUserId && session.user.id !== ownerUserId) {
      check(
        'owner-login-matches-uuid',
        'Owner login',
        'fail',
        `SUPABASE_OWNER_EMAIL signs in as ${session.user.id}, not ${ownerUserId}.`,
      )
      return null
    }
    ownerUserId = session.user.id
    check('owner-login', 'Owner login', 'pass', `Signed in owner user ${ownerUserId}.`)
    return { ...session, temporary: false }
  }

  check('owner-login', 'Owner login', 'warn', 'Owner password was not provided; using a temporary Auth user for live RLS and Storage checks.')
  const session = await createTempUser(serviceClient, 'primary')
  return { ...session, temporary: true }
}

async function ensureBucket(serviceClient) {
  const { data, error } = await serviceClient.storage.getBucket(bucketName)
  if (!error && data) {
    if (data.public) {
      check('storage-bucket-api', 'Storage bucket API', 'fail', `${bucketName} exists but is public.`)
    } else {
      check('storage-bucket-api', 'Storage bucket API', 'pass', `${bucketName} exists and is private.`)
    }
    return
  }

  const { error: createError } = await serviceClient.storage.createBucket(bucketName, {
    public: false,
    fileSizeLimit: 52428800,
    allowedMimeTypes: ['text/html', 'application/octet-stream'],
  })
  if (createError) throw createError
  check('storage-bucket-api', 'Storage bucket API', 'pass', `Created private ${bucketName} bucket.`)
}

async function insertOrFail(client, table, payload, label) {
  const { data, error } = await client.from(table).insert(payload).select('*').single()
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function expectInsertDenied(client, table, payload, label, cleanupInserted) {
  const { data, error } = await client.from(table).insert(payload).select('*').single()
  if (!error) {
    if (cleanupInserted) {
      await cleanupInserted(data)
    } else if (data?.id) {
      await client.from(table).delete().eq('id', data.id)
    }
    throw new Error(`${label}: insert unexpectedly succeeded.`)
  }
}

async function testTableRls(serviceClient, primary, secondary) {
  const primaryCategory = await insertOrFail(
    primary.client,
    'categories',
    {
      owner_id: primary.user.id,
      name: `verify-primary-${runId}`,
      color: '#2563EB',
      sort_order: 999,
    },
    'insert own category',
  )

  const primaryTag = await insertOrFail(
    primary.client,
    'tags',
    {
      owner_id: primary.user.id,
      name: `verify-tag-${runId}`,
      color: '#64748B',
    },
    'insert own tag',
  )

  const primaryDocument = await insertOrFail(
    primary.client,
    'documents',
    {
      owner_id: primary.user.id,
      category_id: primaryCategory.id,
      title: `Verification document ${runId}`,
      storage_path: `${primary.user.id}/__verify/${runId}.html`,
      metadata: { run_id: runId },
    },
    'insert own document',
  )

  cleanupTasks.push(async () => {
    await serviceClient.from('documents').delete().eq('id', primaryDocument.id)
    await serviceClient.from('tags').delete().eq('id', primaryTag.id)
    await serviceClient.from('categories').delete().eq('id', primaryCategory.id)
  })

  await insertOrFail(
    primary.client,
    'document_tags',
    {
      owner_id: primary.user.id,
      document_id: primaryDocument.id,
      tag_id: primaryTag.id,
    },
    'insert own document tag',
  )
  await insertOrFail(
    primary.client,
    'reading_sessions',
    {
      owner_id: primary.user.id,
      document_id: primaryDocument.id,
      duration_seconds: 1,
      last_scroll: 0.1,
    },
    'insert own reading session',
  )
  await insertOrFail(
    primary.client,
    'highlights',
    {
      owner_id: primary.user.id,
      document_id: primaryDocument.id,
      selected_text: `Verification highlight ${runId}`,
    },
    'insert own highlight',
  )
  await insertOrFail(
    primary.client,
    'notes',
    {
      owner_id: primary.user.id,
      document_id: primaryDocument.id,
      body: `Verification note ${runId}`,
    },
    'insert own note',
  )
  await insertOrFail(
    primary.client,
    'personas',
    {
      owner_id: primary.user.id,
      name: `Verification persona ${runId}`,
      tone: 'brief',
      system_prompt: 'You verify RLS.',
    },
    'insert own persona',
  )
  await insertOrFail(
    primary.client,
    'ai_requests',
    {
      owner_id: primary.user.id,
      document_id: primaryDocument.id,
      request_type: 'health_check',
      provider: 'verification',
      model: 'verification',
      status: 'ok',
    },
    'insert own ai request',
  )

  await expectInsertDenied(
    primary.client,
    'categories',
    {
      owner_id: secondary.user.id,
      name: `verify-wrong-owner-${runId}`,
    },
    'insert category with another owner_id',
  )

  const secondaryCategory = await insertOrFail(
    secondary.client,
    'categories',
    {
      owner_id: secondary.user.id,
      name: `verify-secondary-${runId}`,
      color: '#EF4444',
      sort_order: 1000,
    },
    'insert secondary category',
  )

  cleanupTasks.push(async () => {
    await serviceClient.from('categories').delete().eq('id', secondaryCategory.id)
  })

  const primarySeesSecondary = await primary.client
    .from('categories')
    .select('id')
    .eq('id', secondaryCategory.id)
    .maybeSingle()
  if (primarySeesSecondary.error) throw primarySeesSecondary.error
  if (primarySeesSecondary.data) {
    throw new Error('Primary user can read a secondary user category.')
  }

  const secondarySeesPrimary = await secondary.client
    .from('documents')
    .select('id')
    .eq('id', primaryDocument.id)
    .maybeSingle()
  if (secondarySeesPrimary.error) throw secondarySeesPrimary.error
  if (secondarySeesPrimary.data) {
    throw new Error('Secondary user can read a primary user document.')
  }

  await expectInsertDenied(
    secondary.client,
    'documents',
    {
      owner_id: secondary.user.id,
      category_id: primaryCategory.id,
      title: `Verification cross-category ${runId}`,
      storage_path: `${secondary.user.id}/__verify/${runId}-cross-category.html`,
      metadata: { run_id: runId, expected: 'denied' },
    },
    'insert document with another owner category',
  )

  await expectInsertDenied(
    secondary.client,
    'document_tags',
    {
      owner_id: secondary.user.id,
      document_id: primaryDocument.id,
      tag_id: primaryTag.id,
    },
    'insert document tag with another owner document/tag',
    async () => {
      await secondary.client.from('document_tags').delete().eq('document_id', primaryDocument.id).eq('tag_id', primaryTag.id)
    },
  )

  await expectInsertDenied(
    secondary.client,
    'reading_sessions',
    {
      owner_id: secondary.user.id,
      document_id: primaryDocument.id,
      duration_seconds: 1,
      last_scroll: 0,
    },
    'insert reading session with another owner document',
  )

  await expectInsertDenied(
    secondary.client,
    'highlights',
    {
      owner_id: secondary.user.id,
      document_id: primaryDocument.id,
      selected_text: `Cross-user highlight ${runId}`,
    },
    'insert highlight with another owner document',
  )

  await expectInsertDenied(
    secondary.client,
    'notes',
    {
      owner_id: secondary.user.id,
      document_id: primaryDocument.id,
      body: `Cross-user note ${runId}`,
    },
    'insert note with another owner document',
  )

  await expectInsertDenied(
    secondary.client,
    'ai_requests',
    {
      owner_id: secondary.user.id,
      document_id: primaryDocument.id,
      request_type: 'cross_user_health_check',
      provider: 'verification',
      model: 'verification',
      status: 'ok',
    },
    'insert AI request with another owner document',
  )

  const updated = await primary.client
    .from('documents')
    .update({ favorite: true })
    .eq('id', primaryDocument.id)
    .select('favorite')
    .single()
  if (updated.error) throw updated.error
  if (!updated.data?.favorite) throw new Error('Primary user could not update own document.')

  check('rls-live', 'RLS live behavior', 'pass', 'Authenticated users can access own rows and cannot write/read another owner_id or another owner document relation.')
}

async function testStorage(serviceClient, primary, secondary) {
  const primaryPath = `${primary.user.id}/__verify/${runId}.html`
  const wrongPath = `${secondary.user.id}/__verify/${runId}-wrong.html`
  const content = `<main><h1>Supabase verification ${runId}</h1></main>`

  cleanupTasks.push(async () => {
    await serviceClient.storage.from(bucketName).remove([primaryPath, wrongPath])
  })

  const upload = await primary.client.storage.from(bucketName).upload(primaryPath, new Blob([content], { type: 'text/html' }), {
    contentType: 'text/html; charset=utf-8',
    upsert: true,
  })
  if (upload.error) throw upload.error

  const download = await primary.client.storage.from(bucketName).download(primaryPath)
  if (download.error) throw download.error
  const downloaded = await download.data.text()
  if (downloaded !== content) throw new Error('Downloaded Storage object content did not match uploaded content.')

  const list = await primary.client.storage.from(bucketName).list(primary.user.id, { limit: 10 })
  if (list.error) throw list.error

  const wrongUpload = await primary.client.storage
    .from(bucketName)
    .upload(wrongPath, new Blob([content], { type: 'text/html' }), {
      contentType: 'text/html; charset=utf-8',
      upsert: true,
    })
  if (!wrongUpload.error) {
    throw new Error('Primary user uploaded into another user folder.')
  }

  const crossDownload = await secondary.client.storage.from(bucketName).download(primaryPath)
  if (!crossDownload.error) {
    throw new Error('Secondary user downloaded primary user Storage object.')
  }

  const remove = await primary.client.storage.from(bucketName).remove([primaryPath])
  if (remove.error) throw remove.error

  check('storage-live', 'Storage live behavior', 'pass', 'Owner-path upload/download/delete works, and cross-user Storage access is denied.')
}

async function cleanup() {
  for (const task of cleanupTasks.reverse()) {
    try {
      await task()
    } catch {
      // Best-effort cleanup; earlier checks already captured verification failures.
    }
  }
  if (pgClient) {
    await pgClient.end()
  }
}

function printSummary() {
  const summary = {
    generatedAt: new Date().toISOString(),
    supabaseHost: supabaseUrl ? safeHost(supabaseUrl) : '',
    ownerUserId,
    pass: checks.filter((item) => item.status === 'pass').length,
    warn: checks.filter((item) => item.status === 'warn').length,
    fail: checks.filter((item) => item.status === 'fail').length,
    skip: checks.filter((item) => item.status === 'skip').length,
    checks,
  }

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  console.log('Supabase live initialization and verification')
  console.log(`Generated: ${summary.generatedAt}`)
  console.log(`Project: ${summary.supabaseHost || '(not configured)'}`)
  console.log(`Owner UUID: ${ownerUserId || '(not resolved)'}`)
  console.log(`Pass: ${summary.pass}  Warn: ${summary.warn}  Fail: ${summary.fail}  Skip: ${summary.skip}`)
  console.log('')
  for (const item of checks) {
    const mark = item.status === 'pass' ? 'PASS' : item.status === 'warn' ? 'WARN' : item.status === 'skip' ? 'SKIP' : 'FAIL'
    console.log(`[${mark}] ${item.label}: ${item.detail}`)
  }
}

try {
  check(
    'supabase-url',
    'Supabase URL',
    !isPlaceholder(supabaseUrl) && safeHost(supabaseUrl) !== '(invalid url)' ? 'pass' : 'fail',
    supabaseUrl ? `Using ${safeHost(supabaseUrl)}.` : 'Missing SUPABASE_URL or VITE_SUPABASE_URL.',
  )
  check(
    'anon-key',
    'Anon key',
    !isPlaceholder(anonKey) ? 'pass' : 'fail',
    anonKey ? 'Anon key is present.' : 'Missing SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY.',
  )
  check(
    'service-role-key',
    'Service role key',
    !isPlaceholder(serviceRoleKey) ? 'pass' : 'fail',
    serviceRoleKey ? 'Service role key is present.' : 'Missing SUPABASE_SERVICE_ROLE_KEY.',
  )

  assertReady()

  const serviceClient = createServiceClient()

  await applyMigration()
  await inspectRlsAndPolicies()
  await ensureBucket(serviceClient)

  await resolveOwnerUser(serviceClient)
  const primary = await getPrimarySession(serviceClient)
  if (!primary) throw new Error('Owner or temporary primary session is unavailable.')
  const secondary = await createTempUser(serviceClient, 'secondary')

  await testTableRls(serviceClient, primary, secondary)
  await testStorage(serviceClient, primary, secondary)
} catch (error) {
  if (!fatal) {
    check('runtime', 'Runtime verification', 'fail', error instanceof Error ? error.message : String(error))
  }
} finally {
  await cleanup()
  printSummary()
}

if (checks.some((item) => item.status === 'fail')) {
  process.exitCode = 1
}
