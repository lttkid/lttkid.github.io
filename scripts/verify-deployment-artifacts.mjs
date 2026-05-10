import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

const requiredFiles = [
  '.github/workflows/deploy-pages.yml',
  '.github/workflows/deploy-supabase.yml',
  'supabase/config.toml',
  'supabase/migrations/001_initial_schema.sql',
  'supabase/migrations/002_tighten_document_relation_rls.sql',
  'supabase/functions/ai-profiles/index.ts',
  'supabase/functions/ai-health/index.ts',
  'supabase/functions/ai-feature-config/index.ts',
  'supabase/functions/ai-explain/index.ts',
  'supabase/functions/ai-summarize/index.ts',
  'supabase/functions/ai-generate-html/index.ts',
  'scripts/sync-html.mjs',
  'scripts/supabase-live-init.mjs',
  'scripts/prepare-content-repo.mjs',
  'tests/live-smoke.mjs',
  'tests/live-notes.mjs',
  'tests/live-upload.mjs',
  'tests/live-isolation.mjs',
  'templates/content-repo/.github/workflows/sync-html.yml',
  'templates/content-repo/scripts/content-preflight.mjs',
]

const checks = []

function check(label, pass, detail) {
  checks.push({ label, pass, detail })
}

for (const file of requiredFiles) {
  check(file, existsSync(path.join(root, file)), 'Required deployment artifact.')
}

const gitignore = readIfExists('.gitignore')
check('.gitignore protects html/**/*.html', gitignore.includes('html/**/*.html'), 'Private HTML must stay out of the public Pages repository.')

const pagesWorkflow = readIfExists('.github/workflows/deploy-pages.yml')
check('Pages deploys dist', pagesWorkflow.includes('actions/deploy-pages') && pagesWorkflow.includes('path: dist'), 'GitHub Pages should publish the Vite build output.')
check('Pages uses public env only', pagesWorkflow.includes('VITE_SUPABASE_URL') && pagesWorkflow.includes('VITE_SUPABASE_ANON_KEY'), 'Frontend build should only receive anon Supabase config.')

const supabaseWorkflow = readIfExists('.github/workflows/deploy-supabase.yml')
check('Supabase workflow deploys all functions', ['ai-profiles', 'ai-health', 'ai-feature-config', 'ai-explain', 'ai-summarize', 'ai-generate-html'].every((name) => supabaseWorkflow.includes(`functions deploy ${name}`)), 'All Edge Functions used by the app must be deployed.')
check('Supabase workflow requires access token', supabaseWorkflow.includes('SUPABASE_ACCESS_TOKEN'), 'Backend deploys must use a GitHub secret access token.')

const contentWorkflow = readIfExists('templates/content-repo/.github/workflows/sync-html.yml')
check('Content workflow runs dry-run first', contentWorkflow.includes('sync:html -- --dry-run'), 'Private HTML sync should preview before writing.')
check('Content workflow uses service role secret', contentWorkflow.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Only the private content repo should receive the service role key.')

const migration = readIfExists('supabase/migrations/001_initial_schema.sql')
check('Migration creates private html-docs bucket', migration.includes("'html-docs'") && migration.includes('false'), 'Storage bucket must be private.')
check('Migration enables RLS', migration.includes('enable row level security'), 'Tables must be protected by RLS.')

const relationRlsMigration = readIfExists('supabase/migrations/002_tighten_document_relation_rls.sql')
check('Relation RLS migration validates document ownership', relationRlsMigration.includes('documents.owner_id = auth.uid()'), 'Child rows must not reference another user document.')

const aiFeatureMigration = readIfExists('supabase/migrations/007_ai_feature_bindings.sql')
check('AI feature binding migration exists', aiFeatureMigration.includes('ai_feature_bindings') && aiFeatureMigration.includes('enable row level security'), 'Per-feature AI bindings must be stored behind owner RLS.')

const aiUserProvidersMigration = readIfExists('supabase/migrations/008_ai_user_providers.sql')
check('AI user provider migration exists', aiUserProvidersMigration.includes('ai_user_providers') && aiUserProvidersMigration.includes('api_key_ciphertext') && aiUserProvidersMigration.includes('enable row level security'), 'User API keys must be encrypted server-side and protected by owner RLS.')

const aiObservabilityMigration = readIfExists('supabase/migrations/009_ai_observability_and_model_cache.sql')
check('AI observability migration exists', aiObservabilityMigration.includes('ai_model_cache') && aiObservabilityMigration.includes('profile_source') && aiObservabilityMigration.includes('validation_status'), 'AI config needs model cache, binding validation, and traceable ai_requests metadata.')

const packageJson = readIfExists('package.json')
check('Live Supabase verification script exists', packageJson.includes('supabase:live:init'), 'A real Supabase initializer/verifier command should be available.')
check('Live frontend smoke script exists', packageJson.includes('test:live'), 'A real frontend login/library/reader smoke test should be available.')
check('Live upload smoke script exists', packageJson.includes('test:live:upload'), 'A real frontend upload smoke test should be available.')
check('Live isolation smoke script exists', packageJson.includes('test:live:isolation'), 'A real multi-user isolation smoke test should be available.')

function readIfExists(relativePath) {
  const fullPath = path.join(root, relativePath)
  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : ''
}

console.log('Deployment artifact verification')
for (const item of checks) {
  console.log(`[${item.pass ? 'PASS' : 'FAIL'}] ${item.label}: ${item.detail}`)
}

if (checks.some((item) => !item.pass)) {
  process.exitCode = 1
}
