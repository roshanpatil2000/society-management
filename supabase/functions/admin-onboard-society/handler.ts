// Super-admin only: creates a society and its committee accounts in one flow,
// or adds committee members to an existing society.
//
//   1. verify the caller is a platform admin
//   2. *_begin RPC: society (onboarding) + committee invites, in one transaction
//   3. find or create an auth user per committee email (the invite lets the
//      Before User Created hook allow it)
//   4. admin_onboard_finish RPC: memberships, roles, invites accepted, final status
//   5. welcome emails (best effort, reported but never rolled back)
// If 3 or 4 fails, users created in step 3 are deleted and admin_onboard_abort
// revokes the invites and closes the half-made society.
import {
  onboardSocietyRequestSchema,
  type OnboardSocietyRequest,
} from '../../../packages/shared/src/schemas/onboarding.ts';
import { errorResponse, json } from '../_shared/http.ts';
import { escapeHtml, type EmailMessage } from '../_shared/email.ts';

export interface InviteRef {
  invite_id: string;
  email: string;
  full_name: string | null;
}

export interface BeginResult {
  society_id: string;
  invites: InviteRef[];
}

export interface OnboardDeps {
  /** Returns the caller's user id if the bearer token is valid, else null. */
  getCallerId(token: string): Promise<string | null>;
  isPlatformAdmin(userId: string): Promise<boolean>;
  beginOnboard(actor: string, society: unknown, committee: unknown): Promise<BeginResult>;
  beginAddCommittee(actor: string, societyId: string, committee: unknown): Promise<BeginResult>;
  findUsers(emails: string[]): Promise<Map<string, string>>;
  createUser(email: string, fullName: string): Promise<string>;
  deleteUser(userId: string): Promise<void>;
  finish(
    actor: string,
    societyId: string,
    accepts: { invite_id: string; user_id: string }[],
    finalStatus: 'trial' | 'active' | null,
    trialEndsAt: string | null,
  ): Promise<void>;
  abort(actor: string, societyId: string, inviteIds: string[]): Promise<void>;
  sendEmail(message: EmailMessage): Promise<void>;
  societyName(societyId: string): Promise<string>;
  appUrl: string;
}

export function welcomeEmail(
  to: string,
  fullName: string | null,
  societyName: string,
  appUrl: string,
): EmailMessage {
  const name = fullName ?? 'there';
  return {
    to,
    subject: `${societyName} is set up on Society App`,
    text:
      `Hello ${name},\n\n${societyName} is now set up on Society App and you are on its committee.\n` +
      `Sign in at ${appUrl} with this email address (${to}), using the code we email you or Sign in with Google.\n`,
    html:
      `<p>Hello ${escapeHtml(name)},</p>` +
      `<p><strong>${escapeHtml(societyName)}</strong> is now set up on Society App and you are on its committee.</p>` +
      `<p>Sign in at <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a> with this email address ` +
      `(${escapeHtml(to)}), using the code we email you or Sign in with Google.</p>`,
  };
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err)
    return String((err as { message: unknown }).message);
  return String(err);
}

export async function handleOnboard(
  req: Request,
  deps: OnboardDeps,
  token: string | null,
): Promise<Response> {
  if (!token) return errorResponse(401, 'unauthorized', 'Sign in first');
  const actor = await deps.getCallerId(token);
  if (!actor) return errorResponse(401, 'unauthorized', 'Sign in first');
  if (!(await deps.isPlatformAdmin(actor))) {
    return errorResponse(403, 'permission_denied', 'Only the super-admin can onboard societies');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid_request', 'Body must be JSON');
  }
  const parsed = onboardSocietyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      'invalid_request',
      'Check the highlighted fields',
      parsed.error.issues,
    );
  }
  const request: OnboardSocietyRequest = parsed.data;

  // Step 2: society + invites in one transaction. Nothing to undo if it fails.
  let begun: BeginResult;
  try {
    begun =
      request.action === 'onboard'
        ? await deps.beginOnboard(actor, request.society, request.committee)
        : await deps.beginAddCommittee(actor, request.society_id, request.committee);
  } catch (err) {
    return errorResponse(400, 'onboarding_failed', messageOf(err));
  }

  const createdUserIds: string[] = [];
  try {
    // Step 3: reuse existing accounts, create the rest.
    const existing = await deps.findUsers(begun.invites.map((i) => i.email));
    const accepts: { invite_id: string; user_id: string }[] = [];
    for (const invite of begun.invites) {
      let userId = existing.get(invite.email);
      if (!userId) {
        userId = await deps.createUser(invite.email, invite.full_name ?? '');
        createdUserIds.push(userId);
      }
      accepts.push({ invite_id: invite.invite_id, user_id: userId });
    }

    // Step 4: memberships and final status.
    await deps.finish(
      actor,
      begun.society_id,
      accepts,
      request.action === 'onboard' ? request.status : null,
      request.action === 'onboard' ? (request.trial_ends_at ?? null) : null,
    );
  } catch (err) {
    const cleanup: string[] = [];
    for (const userId of createdUserIds) {
      try {
        await deps.deleteUser(userId);
      } catch (deleteErr) {
        cleanup.push(`could not delete user ${userId}: ${messageOf(deleteErr)}`);
      }
    }
    try {
      await deps.abort(
        actor,
        begun.society_id,
        begun.invites.map((i) => i.invite_id),
      );
    } catch (abortErr) {
      cleanup.push(`could not abort onboarding: ${messageOf(abortErr)}`);
    }
    return errorResponse(500, 'onboarding_failed', messageOf(err), {
      society_id: begun.society_id,
      rolled_back: cleanup.length === 0,
      cleanup_errors: cleanup,
    });
  }

  // Step 5: welcome emails. Failures are reported, not rolled back.
  const societyName = await deps.societyName(begun.society_id).catch(() => 'Your society');
  const emailFailures: { email: string; error: string }[] = [];
  for (const invite of begun.invites) {
    try {
      await deps.sendEmail(welcomeEmail(invite.email, invite.full_name, societyName, deps.appUrl));
    } catch (err) {
      emailFailures.push({ email: invite.email, error: messageOf(err) });
    }
  }

  return json({
    society_id: begun.society_id,
    committee: begun.invites.map((i) => i.email),
    accounts_created: createdUserIds.length,
    welcome_email_failures: emailFailures,
  });
}
