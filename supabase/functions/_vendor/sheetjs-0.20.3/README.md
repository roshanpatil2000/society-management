# SheetJS Community Edition 0.20.3

Copied unchanged from https://cdn.sheetjs.com/xlsx-0.20.3/package/ (xlsx.mjs,
types/index.d.ts as types.d.ts, LICENSE: Apache-2.0).

Kept in the repo because the hosted Edge Function bundler cannot fetch from
cdn.sheetjs.com. The npm `xlsx` package is stuck at 0.18.5, which has known
vulnerabilities, so it is not an option.

xlsx.mjs sha256: 1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db

To upgrade: download the new version's files into a new folder, check the
hash, and point supabase/functions/import-flats/deno.json at it.
