/// <reference types="@cloudflare/workers-types" />
//
// POST /api/entry, promotion entry endpoint (Cloudflare Pages Function).
//
// Flow: verify Turnstile → validate → insert into D1 (critical) →
// send Brevo confirmation email + upsert contact (best-effort, background) → redirect.
// TODO (later): photo → R2.

interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  TURNSTILE_SECRET_KEY?: string;
  BREVO_API_KEY?: string;
  BREVO_MARKETING_LIST_ID?: string;
  BREVO_TEMPLATE_ID?: string;
}

// Cloudflare Turnstile TEST secret ("always passes"), dev fallback only.
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Photo upload limits (keep in sync with the copy on the form).
const MAX_PHOTO_BYTES = 50 * 1024 * 1024; // 50 MB
const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const REQUIRED_FIELDS = [
  "parent",
  "email",
  "squad",
  "participants",
  "postcode",
  "platform",
  "story",
  "consent_promo",
  "consent_terms",
] as const;

interface Entry {
  id: string;
  created_at: string;
  parent_name: string;
  email: string;
  squad_name: string;
  participants: number | null;
  pledge: string | null;
  platform: string;
  post_url: string | null;
  story: string;
  postcode: string;
  photo_key: string | null;
  consent_promo: number;
  consent_terms: number;
  consent_marketing: number;
  ip: string | null;
  country: string | null;
  user_agent: string | null;
}

function redirect(request: Request, path: string, status = 303): Response {
  return new Response(null, {
    status,
    headers: { Location: new URL(path, request.url).toString() },
  });
}

async function verifyTurnstile(token: string, secret: string, ip: string | null): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    const data = (await res.json()) as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

async function insertEntry(db: D1Database, e: Entry): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entries (
        id, created_at, parent_name, email, squad_name, participants, pledge,
        platform, post_url, story, postcode, photo_key, consent_promo, consent_terms,
        consent_marketing, ip, country, user_agent
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      e.id, e.created_at, e.parent_name, e.email, e.squad_name, e.participants,
      e.pledge, e.platform, e.post_url, e.story, e.postcode, e.photo_key, e.consent_promo,
      e.consent_terms, e.consent_marketing, e.ip, e.country, e.user_agent
    )
    .run();
}

// Store the entrant's photo/screenshot in R2. Returns the object key.
async function uploadPhoto(env: Env, file: File, id: string): Promise<string> {
  const ext = PHOTO_EXT[file.type] ?? "bin";
  const key = `entries/${id}.${ext}`;
  await env.PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { entryId: id },
  });
  return key;
}

async function sendConfirmationEmail(env: Env, e: Entry): Promise<void> {
  const firstName = e.parent_name.split(/\s+/)[0] || "there";
  const to = [{ email: e.email, name: e.parent_name }];
  const templateId = env.BREVO_TEMPLATE_ID ? Number(env.BREVO_TEMPLATE_ID) : NaN;

  // Preferred: a Brevo-managed template (responsive, editable by marketers).
  // The template should reference {{ params.firstName }} and {{ params.squad }}.
  // Fallback: inline HTML, used until BREVO_TEMPLATE_ID is configured.
  const payload = Number.isFinite(templateId)
    ? { to, templateId, params: { firstName, squad: e.squad_name } }
    : {
        sender: { name: "Bright July", email: "noreply@brightjuly.com.au" },
        to,
        subject: "Your Bright July entry is in 🌞",
        htmlContent: `<!doctype html><html><body style="margin:0;background:#FAF6EF;font-family:Arial,Helvetica,sans-serif;color:#3A332B">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px">
      <h1 style="font-size:24px;color:#1F1B16;margin:0 0 16px">Thanks for entering Bright July, ${firstName}!</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px">We've received your entry for squad <strong>${e.squad_name}</strong>.</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px">Keep getting outdoors and come back next week with another moment, winners are announced each Monday during July.</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px">Share your outdoor moment with <strong>#brightjulyAU</strong> and tag <strong>@brightjulyAU</strong>.</p>
      <p style="font-size:14px;color:#6E6357;margin:24px 0 0">The Bright July team</p>
    </div></body></html>`,
      };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY!,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Brevo email ${res.status}: ${await res.text()}`);
}

async function upsertContact(env: Env, e: Entry): Promise<void> {
  const [first, ...rest] = e.parent_name.split(/\s+/);
  const listId = env.BREVO_MARKETING_LIST_ID ? Number(env.BREVO_MARKETING_LIST_ID) : NaN;
  const body: Record<string, unknown> = {
    email: e.email,
    attributes: {
      FNAME: first ?? "",
      LNAME: rest.join(" "),
      SQUAD: e.squad_name,
      POSTCODE: e.postcode,
    },
    updateEnabled: true,
  };
  // Only subscribe to the marketing list when the entrant opted in.
  if (e.consent_marketing === 1 && Number.isFinite(listId)) {
    body.listIds = [listId];
  }

  const res = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY!,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Brevo contact ${res.status}: ${await res.text()}`);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect(request, "/promotion?error=invalid#entry");
  }

  // 1. Turnstile
  const token = String(form.get("cf-turnstile-response") ?? "");
  if (!token) return redirect(request, "/promotion?error=verification#entry");
  const secret = env.TURNSTILE_SECRET_KEY ?? TURNSTILE_TEST_SECRET;
  if (!env.TURNSTILE_SECRET_KEY) {
    console.warn("TURNSTILE_SECRET_KEY not set, using test secret (dev only).");
  }
  const ip = request.headers.get("CF-Connecting-IP");
  if (!(await verifyTurnstile(token, secret, ip))) {
    return redirect(request, "/promotion?error=verification#entry");
  }

  // 2. Validate
  for (const field of REQUIRED_FIELDS) {
    const value = form.get(field);
    if (value === null || String(value).trim() === "") {
      return redirect(request, "/promotion?error=fields#entry");
    }
  }
  const email = String(form.get("email")).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return redirect(request, "/promotion?error=email#entry");
  }

  const str = (k: string) => {
    const v = form.get(k);
    return v === null || String(v).trim() === "" ? null : String(v).trim();
  };
  // 3. Optional photo → R2 (best-effort: an infra failure won't lose the entry,
  //    but a wrong type / oversize file is rejected so the entrant can fix it).
  const id = crypto.randomUUID();
  let photoKey: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!(photo.type in PHOTO_EXT)) {
      return redirect(request, "/promotion?error=phototype#entry");
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return redirect(request, "/promotion?error=photosize#entry");
    }
    try {
      photoKey = await uploadPhoto(env, photo, id);
    } catch (err) {
      console.error("R2 upload failed:", err);
      photoKey = null;
    }
  }

  const participantsNum = Number(form.get("participants"));
  const entry: Entry = {
    id,
    created_at: new Date().toISOString(),
    parent_name: String(form.get("parent")).trim(),
    email,
    squad_name: String(form.get("squad")).trim(),
    participants: Number.isFinite(participantsNum) ? participantsNum : null,
    pledge: str("pledge"),
    platform: String(form.get("platform")).trim(),
    post_url: str("url"),
    story: String(form.get("story")).trim(),
    postcode: String(form.get("postcode")).trim(),
    photo_key: photoKey,
    consent_promo: form.get("consent_promo") ? 1 : 0,
    consent_terms: form.get("consent_terms") ? 1 : 0,
    consent_marketing: form.get("consent_marketing") ? 1 : 0,
    ip,
    country: request.headers.get("CF-IPCountry"),
    user_agent: request.headers.get("User-Agent"),
  };

  // 4. Persist (critical), fail the submission if this errors so the entrant can retry.
  try {
    await insertEntry(env.DB, entry);
  } catch (err) {
    console.error("D1 insert failed:", err);
    return redirect(request, "/promotion?error=server#entry");
  }

  // 5. Brevo email + contact (best-effort, in the background, never blocks the entrant).
  if (env.BREVO_API_KEY) {
    context.waitUntil(
      Promise.allSettled([sendConfirmationEmail(env, entry), upsertContact(env, entry)]).then(
        (results) => {
          for (const r of results) {
            if (r.status === "rejected") console.error("Brevo:", r.reason);
          }
        }
      )
    );
  } else {
    console.warn("BREVO_API_KEY not set, skipping confirmation email/contact (dev).");
  }

  return redirect(request, "/promotion/success");
};
