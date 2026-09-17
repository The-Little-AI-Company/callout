/**
 * Beta signup handler (PRD L2, L3, L3a). One serverless function, Vercel
 * style (Node runtime). No database: Resend Contacts is the roster.
 *
 *   POST /api/signup { email, os, reads[], consent }
 *
 * Flow:
 *   1. validate
 *   2. count confirmed contacts in the audience; over the cap means waitlist
 *   3. create the contact (unsubscribed=false), tagged by wave in first_name
 *   4. send the confirmation to the tester and a copy to the partner inbox
 *
 * Environment:
 *   RESEND_API_KEY      Resend key
 *   RESEND_AUDIENCE_ID  audience that holds the roster
 *   SIGNUP_FROM         e.g. "Callout <beta@example.com>"
 *   SIGNUP_INBOX        shared partner inbox
 *   SIGNUP_CAP          default 20
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const RESEND = "https://api.resend.com";

interface Signup {
  email: string;
  os: string;
  reads: string[];
  consent: boolean;
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    send(res, 405, { message: "POST only." });
    return;
  }
  const body = await readJson(req);
  const parsed = validate(body);
  if ("error" in parsed) {
    send(res, 400, { message: parsed.error });
    return;
  }
  const env = {
    key: process.env.RESEND_API_KEY,
    audience: process.env.RESEND_AUDIENCE_ID,
    from: process.env.SIGNUP_FROM,
    inbox: process.env.SIGNUP_INBOX,
    cap: Number(process.env.SIGNUP_CAP ?? "20"),
  };
  if (!env.key || !env.audience || !env.from || !env.inbox) {
    send(res, 500, { message: "Signup is not configured yet." });
    return;
  }
  const headers = { authorization: `Bearer ${env.key}`, "content-type": "application/json" };

  try {
    const count = await confirmedCount(env.audience, headers);
    const wave = count < env.cap ? "wave1" : "waitlist";

    const created = await fetch(`${RESEND}/audiences/${env.audience}/contacts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: parsed.email, first_name: wave, last_name: `${parsed.os}|${parsed.reads.join(",")}`, unsubscribed: false }),
    });
    if (!created.ok && created.status !== 409) {
      const t = await created.text();
      throw new Error(`contact create ${created.status}: ${t}`);
    }

    const waitlist = wave === "waitlist";
    const subject = waitlist ? "You're on the Callout waitlist" : "You're on the Callout list";
    const text = waitlist
      ? "Wave one is full. You're on the list, and you'll hear from us when wave two opens.\n\nCallout uses your own API keys and never sends checked text to us. More at the landing page.\n\nThe skullbunny sends its regards."
      : "You're in the queue for wave one. Invites go out in order with a download link, a setup guide for the three keys, and a feedback link.\n\nCallout uses your own API keys and never sends checked text to us.\n\nThe skullbunny is sniffing for hogwash on your behalf.";

    await sendEmail(headers, { from: env.from, to: [parsed.email], subject, text });
    await sendEmail(headers, {
      from: env.from,
      to: [env.inbox],
      subject: `[callout signup] ${wave} ${parsed.email}`,
      text: `email: ${parsed.email}\nos: ${parsed.os}\nreads: ${parsed.reads.join(", ") || "none"}\nwave: ${wave}\nconfirmed so far: ${count}`,
    });

    send(res, 200, { message: waitlist ? "Wave one is full. You're on the list, and you'll hear from us when wave two opens. Confirmation sent." : "You're in the queue. Confirmation sent, check your inbox.", wave });
  } catch (e) {
    console.error(e);
    send(res, 502, { message: "Signup service error. Try again in a minute." });
  }
}

async function confirmedCount(audience: string, headers: Record<string, string>): Promise<number> {
  const res = await fetch(`${RESEND}/audiences/${audience}/contacts`, { headers });
  if (!res.ok) throw new Error(`contacts list ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ first_name?: string; unsubscribed?: boolean }> };
  return (json.data ?? []).filter((c) => c.first_name === "wave1" && !c.unsubscribed).length;
}

async function sendEmail(headers: Record<string, string>, msg: { from: string; to: string[]; subject: string; text: string }): Promise<void> {
  const res = await fetch(`${RESEND}/emails`, { method: "POST", headers, body: JSON.stringify(msg) });
  if (!res.ok) throw new Error(`email ${res.status}: ${await res.text()}`);
}

export function validate(body: unknown): Signup | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email." };
  const os = typeof b.os === "string" && ["windows", "mac", "linux"].includes(b.os) ? b.os : "";
  if (!os) return { error: "Pick an operating system." };
  const allowed = new Set(["news", "social", "ads", "chat", "docs", "video"]);
  const reads = Array.isArray(b.reads) ? b.reads.filter((r): r is string => typeof r === "string" && allowed.has(r)) : [];
  if (b.consent !== true) return { error: "Consent is required so we can email you about Callout." };
  return { email, os, reads, consent: true };
}

async function readJson(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
