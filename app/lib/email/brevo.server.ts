// Brevo transactional email API (verified 2026-10-16 against
// https://developers.brevo.com/reference/send-transac-email):
// POST https://api.brevo.com/v3/smtp/email, header `api-key`, JSON body with
// sender {name,email}, to [{email}], replyTo {email}, subject, htmlContent,
// textContent, headers, tags. 201 → { messageId }. Errors: 400 { code, message }.
//
// The sender address must be a sender/domain verified in OUR Brevo account
// (BREVO_SENDER_EMAIL); the sender NAME is the store's name and replies go to
// the merchant (Shop.email), so applicants never write to us.

export const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 15_000;

export type OutgoingEmail = {
  to: string;
  senderName: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  tag: string;
  idempotencyKey: string; // our EmailLog id, so a retried request is not sent twice
};

/** ok, retry later (network/5xx/429), or permanent failure (4xx: bad address, bad request). */
export type SendResult = { ok: true; messageId?: string } | { ok: false; retry: boolean; status: number; code?: string };

export function brevoConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);
}

export function brevoBody(e: OutgoingEmail) {
  return {
    // Brevo allows 70 characters for names.
    sender: { name: e.senderName.slice(0, 70), email: process.env.BREVO_SENDER_EMAIL },
    to: [{ email: e.to }],
    ...(e.replyTo ? { replyTo: { email: e.replyTo } } : {}),
    subject: e.subject,
    htmlContent: e.html,
    textContent: e.text,
    headers: { IdempotencyKey: e.idempotencyKey },
    tags: ["tradepass", e.tag],
  };
}

export async function sendViaBrevo(e: OutgoingEmail, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const key = process.env.BREVO_API_KEY;
  if (!key || !process.env.BREVO_SENDER_EMAIL) return { ok: false, retry: true, status: 0, code: "not_configured" };
  let res: Response;
  try {
    res = await fetchImpl(BREVO_URL, {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(brevoBody(e)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, retry: true, status: 0, code: "network" };
  }
  if (res.status === 201 || res.status === 202) {
    const json = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, messageId: json.messageId };
  }
  const err = (await res.json().catch(() => ({}))) as { code?: string };
  // Our key or account is the problem (401/403, "unauthorized", out of credits):
  // keep emails queued until it's fixed instead of failing them.
  const accountProblem = res.status === 401 || res.status === 403 || /unauthori|credit|authentication/i.test(err.code ?? "");
  const retry = res.status >= 500 || res.status === 429 || accountProblem;
  return { ok: false, retry, status: res.status, code: err.code };
}
