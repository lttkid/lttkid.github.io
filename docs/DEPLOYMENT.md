# Deployment Checklist

## Supabase

1. Create a Supabase project.
2. In Authentication settings, disable public sign-ups. In Supabase, open **Authentication > Providers > Email**, turn off public signups, and keep manual user creation enabled.
3. Create your own user manually in Supabase Auth.
4. Run `supabase/migrations/001_initial_schema.sql` in SQL Editor. This migration includes `documents.sort_order`, which is required before the live app can load the manually sorted library.
5. Copy your Auth user UUID. Use it as `SUPABASE_OWNER_USER_ID` for HTML sync.
6. Deploy functions:

```bash
supabase functions deploy ai-profiles
supabase functions deploy ai-health
supabase functions deploy ai-feature-config
supabase functions deploy ai-explain
supabase functions deploy ai-summarize
supabase functions deploy ai-generate-html
```

7. Set Edge Function secrets:

```bash
supabase secrets set AI_PROVIDER=openai-compatible
supabase secrets set AI_PROFILE_LABEL="Default Model"
supabase secrets set AI_MODEL="your-model"
supabase secrets set AI_BASE_URL="https://api.openai.com/v1"
supabase secrets set AI_API_KEY="your-api-key"
```

8. Run the live initializer and verifier from this repo:

```bash
npm run supabase:live:init
```

For a fully automated run, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and either `SUPABASE_DB_URL` or `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD`. Set `SUPABASE_OWNER_USER_ID` if you already copied the Auth UUID, or set `SUPABASE_OWNER_EMAIL` + `SUPABASE_OWNER_PASSWORD` and `SUPABASE_CREATE_OWNER_IF_MISSING=true` to let the script create or resolve the owner. The script applies `supabase/migrations/001_initial_schema.sql`, confirms RLS and Storage policies in the live database, signs in real Auth users, verifies owner UUID behavior, uploads/downloads a private Storage object, and confirms cross-user access is denied.

For multiple OpenAI-compatible providers, keep keys as Edge Function secrets and point profiles to secret names:

```bash
supabase secrets set OPENAI_API_KEY="..."
supabase secrets set DEEPSEEK_API_KEY="..."
supabase secrets set AI_PROFILES_JSON='[{"id":"openai","label":"OpenAI GPT","provider":"openai-compatible","model":"gpt-4o-mini","enabled":true,"baseUrl":"https://api.openai.com/v1","apiKeyEnv":"OPENAI_API_KEY"},{"id":"deepseek","label":"DeepSeek Chat","provider":"openai-compatible","model":"deepseek-chat","enabled":true,"baseUrl":"https://api.deepseek.com/v1","apiKeyEnv":"DEEPSEEK_API_KEY"}]'
```

You can also deploy the Supabase backend from GitHub Actions. Add these public frontend repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD` if you want the workflow to apply migrations

Then run **Deploy Supabase backend** manually. Use `apply_migrations=true` only when you are ready to push `supabase/migrations` to the linked project. Use `deploy_functions=true` to deploy `ai-profiles`, `ai-health`, `ai-feature-config`, `ai-explain`, `ai-summarize`, and `ai-generate-html`.

## Public GitHub Pages Repository

Add repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then enable Pages with GitHub Actions as the deployment source.

In the deployed app, open **系统体检** after logging in. It should show four readable status zones: frontend site, Supabase backend, private files, and AI service.

- Demo Mode is disabled.
- Supabase frontend config is present and the login session is active.
- `html-docs` private Storage is accessible.
- `ai-profiles` returns at least one model profile.
- `ai-generate-html` can generate a strict self-contained HTML page through the generator, including optional image-based question understanding when the selected model supports vision input.
- The AI configuration center shows profiles without exposing API keys.
- The AI configuration center can load `ai-feature-config`, apply provider templates, fetch/cache model lists through `/models`, save per-feature profile bindings, immediately validate them, and show not-deployed hints for unavailable backends.
- Clicking **测试 AI 连接** runs `ai-health` and records `health_check` rows in `ai_requests`.

The API configuration center supports server-managed profiles and per-user OpenAI-compatible providers. User-entered API keys are submitted once to `ai-feature-config`, encrypted with `AI_USER_KEY_ENCRYPTION_SECRET`, and never returned to the frontend. The UI only shows a masked key hint. AI calls and binding validation write `feature_id`, `profile_id`, `profile_source`, `used_model`, `error_code`, and latency metadata into `ai_requests` so the operator can prove which model was actually used.

Before release, run the frontend smoke and live tests with a real Auth user that has at least one synced or uploaded document:

```bash
npm run test:smoke
npm run test:live
npm run test:live:notes
npm run test:live:upload
```

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `LIVE_TEST_EMAIL`, and `LIVE_TEST_PASSWORD` first. The test signs in through the UI, confirms the library renders real rows, downloads the first HTML file from private Storage, and verifies the reader iframe renders non-empty content.

For the multi-user isolation check, create a second manual Auth user and set `LIVE_SECOND_EMAIL` plus `LIVE_SECOND_PASSWORD`, then run:

```bash
npm run test:live:isolation
```

That script verifies user B cannot see user A's document row, cannot download user A's Storage object, and cannot read user A's highlights or AI request records. V2 intentionally does not add shared libraries or public links.

## Private HTML Repository

Use a separate private repository for real HTML content. Scaffold it from this frontend repo:

```bash
npm run prepare:content-repo -- ../html-vault-content
```

The scaffold includes:

- `scripts/sync-html.mjs`
- `.github/workflows/sync-html.yml`
- `scripts/content-preflight.mjs`
- `package.json`
- `html/.gitkeep`

After generating the scaffold, run `npm install` in the private content repo to create a lockfile, initialize a private GitHub repository, and push it.

Add repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_OWNER_USER_ID`

Place documents under `html/`. The first folder level becomes the category name.

Before the real sync, run:

```bash
npm run content:preflight
npm run sync:html -- --dry-run
```

The sync summary reports:

- `scanned`: HTML files discovered.
- `indexed`: files with extracted searchable text.
- `uploaded`: files that would be uploaded or updated.
- `unchanged`: files with matching hashes.
- `archived`: database documents missing from the source folder.
- `failed`: files or archive operations that failed.

The real Action writes the same summary to the GitHub Actions job summary.

Each synced document stores a private text index in `documents.content_text`, plus `word_count` and `indexed_at`. The index is truncated to 200,000 characters by default and remains protected by the same RLS rules as the document row. You can override the limit with `HTML_SYNC_MAX_INDEX_CHARS`.

Manual library order is stored in `documents.sort_order`. New sync rows receive an initial order, while updates preserve the existing order so a content sync does not reset a user's personal shelf.

## Verification

Before deploying:

```bash
npm run preflight
npm run verify:deployment
npm run prepare:content-repo -- ../html-vault-content --force
npm run build
npm run test:smoke
npm run sync:html -- --dry-run
```

After deploying, confirm:

- Opening the GitHub Pages URL shows the login page.
- Unknown visitors cannot download Storage objects.
- Your manually created user can log in.
- A private repo sync run creates `documents` rows and uploads files under `html-docs/{user-id}/...`.
- Frontend upload creates documents under `html-docs/{user-id}/uploads/{yyyy}/{mm}/...` and writes `documents.owner_id` as the current user.
- Reader starts in 阅读模式, and a trusted sample with inline click logic only responds after switching to 交互模式.
- Selecting text in the reader opens the assistant panel and AI requests go through Edge Functions.
- AI HTML 生成器 can preview, revise, optionally read a local question image, and save generated HTML into `html-docs/{user-id}/generated/{yyyy}/{mm}/...`.
- In **系统体检**, the AI configuration center can run a real lightweight health check for each enabled OpenAI-compatible profile.
- Saved highlights appear in **笔记中心**, where they can be filtered, edited, deleted, and opened back in the reader.
- Archiving a document hides it from the default library, and the archive view can restore it.

## Troubleshooting

- `preflight` fails on missing secrets: expected until `.env.local` or GitHub Secrets are configured.
- Login works but documents do not load: confirm RLS policies were created by the SQL migration.
- Storage download fails: confirm files are uploaded under `html-docs/{auth-user-id}/...`.
- AI calls fail: confirm Edge Functions are deployed, including `ai-health` and `ai-generate-html`, and `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` secrets are set.
- `sync:html -- --dry-run` shows `scanned: 0`: confirm real files are under the configured `html/` directory and are not only `.gitkeep`.
- Library full-text search finds titles but not body text: rerun the HTML sync after applying the migration so `content_text`, `word_count`, and `indexed_at` are populated.
- Uploaded HTML is visible to the uploader but not another user: this is expected. V2 is strictly private per user; use `test:live:isolation` to confirm RLS and Storage policies.
