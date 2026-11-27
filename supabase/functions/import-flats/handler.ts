// POST {society_id, file_base64, dry_run?}: parses the spreadsheet and calls the
// import_flats RPC with the caller's own session, so their permissions and the
// society's quotas apply. Returns the RPC's report (or the file's problems).
import { z } from 'zod';

import { errorResponse, json } from '../_shared/http.ts';
import { type FlatRow, parseFlatSheet } from './parse.ts';

export interface ImportDeps {
  callImport(token: string, societyId: string, rows: FlatRow[], dryRun: boolean): Promise<unknown>;
}

const MAX_BASE64_LENGTH = Math.ceil((2 * 1024 * 1024 * 4) / 3); // 2 MB file

const bodySchema = z.object({
  society_id: z.uuid(),
  file_base64: z.string().min(1),
  dry_run: z.boolean().default(false),
});

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/^data:[^,]*,/, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function handleImport(
  req: Request,
  deps: ImportDeps,
  token: string | null,
): Promise<Response> {
  if (!token) return errorResponse(401, 'unauthorized', 'Sign in first');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid_request', 'Body must be JSON');
  }
  const raw = body as { file_base64?: unknown };
  if (typeof raw.file_base64 === 'string' && raw.file_base64.length > MAX_BASE64_LENGTH) {
    return errorResponse(413, 'file_too_large', 'The file is larger than 2 MB');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success)
    return errorResponse(400, 'invalid_request', 'Check the request', parsed.error.issues);

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(parsed.data.file_base64);
  } catch {
    return errorResponse(400, 'invalid_request', 'The file is not valid base64');
  }

  const { rows, problems } = parseFlatSheet(bytes);
  if (problems.length > 0) {
    return json({
      ok: false,
      wings_created: 0,
      flats_created: 0,
      invites_created: 0,
      errors: problems.map((message) => ({ row: 0, field: 'file', message })),
    });
  }

  try {
    return json(await deps.callImport(token, parsed.data.society_id, rows, parsed.data.dry_run));
  } catch (err) {
    const e = err as { message?: string; code?: string };
    if (e.code === '42501')
      return errorResponse(403, 'permission_denied', e.message ?? 'Not allowed');
    return errorResponse(400, 'import_failed', e.message ?? 'The import failed');
  }
}
