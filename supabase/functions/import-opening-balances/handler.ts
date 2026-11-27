// POST {society_id, as_of, file_base64, dry_run?}: parses the opening-balances
// workbook and calls post_opening_balances with the caller's own session, so
// their permissions apply. Returns the database's report (or the file's problems).
import { z } from 'zod';

import { errorResponse, json } from '../_shared/http.ts';
import { type AccountBalance, type FlatBalance, parseOpeningWorkbook } from './parse.ts';

export interface OpeningDeps {
  callOpening(
    token: string,
    societyId: string,
    asOf: string,
    flats: FlatBalance[],
    accounts: AccountBalance[],
    dryRun: boolean,
  ): Promise<unknown>;
}

const MAX_BASE64_LENGTH = Math.ceil((2 * 1024 * 1024 * 4) / 3); // 2 MB file

const bodySchema = z.object({
  society_id: z.uuid(),
  as_of: z.iso.date(),
  file_base64: z.string().min(1),
  dry_run: z.boolean().default(false),
});

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/^data:[^,]*,/, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function handleOpening(
  req: Request,
  deps: OpeningDeps,
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

  const { flats, accounts, problems } = parseOpeningWorkbook(bytes);
  if (problems.length > 0) {
    return json({
      ok: false,
      entry_id: null,
      flats: 0,
      total_debit: 0,
      total_credit: 0,
      errors: problems,
    });
  }

  try {
    const { society_id, as_of, dry_run } = parsed.data;
    return json(await deps.callOpening(token, society_id, as_of, flats, accounts, dry_run));
  } catch (err) {
    const e = err as { message?: string; code?: string };
    const message = e.message ?? 'Posting the opening balances failed';
    if (e.code === '42501') return errorResponse(403, 'permission_denied', message);
    if (e.code === 'P0001') {
      const code = /^([a-z_]+):/.exec(message)?.[1] ?? 'conflict';
      return errorResponse(409, code, message);
    }
    return errorResponse(400, 'import_failed', message);
  }
}
