# HTML Vault Private Content

This private repository stores the real `html/` source files and syncs them into the private Supabase Storage bucket used by HTML Vault Reader.

## Setup

1. Keep this GitHub repository private.
2. Add repository secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_OWNER_USER_ID`
3. Put documents under `html/`. The first folder level becomes the category name.
4. Run `npm install` once so the repository has a lockfile before enabling `npm ci` in CI.

## Commands

```bash
npm run content:preflight
npm run sync:html -- --dry-run
npm run sync:html
```

The sync uploads changed HTML files to `html-docs/{SUPABASE_OWNER_USER_ID}/...`, upserts `documents`, extracts a private text index, and archives database rows that no longer exist in `html/`.
