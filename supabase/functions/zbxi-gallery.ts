// zbxi-gallery — mints short-lived Cloudflare R2 presigned URLs for the members-only
// photo gallery. The board's thread photos and the homepage teaser share the same
// client helpers, so they ride on this too. Replaces Supabase Storage signed URLs
// with R2 (10 GB free, zero egress). Image BYTES live in R2; all metadata
// (gallery_posts/likes/comments, forum_threads) stays in Supabase Postgres.
//
// Privacy is identical to the old flow: only approved brothers can mint URLs, and
// the URLs are short-lived bearer URLs (1 h view / 10 min upload). The DB stays the
// single enforcer — permission checks run as RPCs WITH THE CALLER'S JWT.
//
//   POST { op:'sign-view',   paths:[key,...] } -> { urls:{key:GET url} }  (approved brother/admin)
//   POST { op:'sign-upload', ext? }            -> { key, url:PUT url }    (admin OR officer gallery.post)
//   POST { op:'delete-post', id }              -> { ok } | 404            (RLS decides via the caller's JWT)
import { AwsClient } from "npm:aws4fetch@1.0.20";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ACCOUNT = Deno.env.get("R2_ACCOUNT_ID")!;
const BUCKET = Deno.env.get("R2_BUCKET")!;
const R2_BASE = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}`;

const r2 = new AwsClient({
  accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
  secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  service: "s3",
  region: "auto",
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Object keys are `<auth uid>/<ms timestamp>.<ext>` — reject anything else so a
// crafted `paths` entry can't reach outside the gallery's own objects.
const KEY_RE = /^[0-9a-f-]{36}\/\d{10,}\.(jpg|jpeg|png|webp)$/i;

let _adminEmail: string | null = null;
async function adminEmail(): Promise<string> {
  if (_adminEmail) return _adminEmail;
  const r = await fetch(`${SB}/rest/v1/rpc/admin_email`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error("admin_email lookup failed");
  _adminEmail = String(await r.json()).toLowerCase();
  return _adminEmail;
}

// The verified caller: {id, email} from their JWT, or null.
async function callerUser(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? { id: String(u.id), email: String(u.email || "").toLowerCase() } : null;
}

// Run an RPC AS THE CALLER (their JWT), so the DB's own role/grant logic decides.
async function callerRpc(req: Request, fn: string, args: unknown = {}): Promise<unknown> {
  const auth = req.headers.get("Authorization")!;
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return r.ok ? await r.json() : null;
}

async function presign(key: string, method: "GET" | "PUT", expires: number): Promise<string> {
  const u = new URL(`${R2_BASE}/${key}`);
  u.searchParams.set("X-Amz-Expires", String(expires));
  const signed = await r2.sign(u.toString(), { method, aws: { signQuery: true } });
  return signed.url;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const me = await callerUser(req);
  if (!me) return json({ error: "forbidden" }, 403);

  try {
    const { op, paths = [], ext = "jpg", id = null } = await req.json().catch(() => ({}));
    const isAdmin = me.email === (await adminEmail());

    if (op === "sign-view") {
      const ok = isAdmin || (await callerRpc(req, "is_approved_brother")) === true;
      if (!ok) return json({ error: "forbidden" }, 403);
      const list = Array.isArray(paths) ? paths.slice(0, 200) : [];
      const urls: Record<string, string> = {};
      for (const p of list) {
        if (typeof p === "string" && KEY_RE.test(p)) urls[p] = await presign(p, "GET", 3600);
      }
      return json({ urls });
    }

    if (op === "sign-upload") {
      const ok = isAdmin || (await callerRpc(req, "officer_can", { perm: "gallery.post" })) === true;
      if (!ok) return json({ error: "forbidden" }, 403);
      // Key derives from the VERIFIED caller uid — a client can't upload into
      // someone else's folder (mirrors the storage owner-prefix RLS).
      const safeExt = /^(jpg|jpeg|png|webp)$/i.test(String(ext)) ? String(ext).toLowerCase() : "jpg";
      const key = `${me.id}/${Date.now()}.${safeExt}`;
      return json({ key, url: await presign(key, "PUT", 600) });
    }

    if (op === "delete-post") {
      if (!id) return json({ error: "id required" }, 400);
      // Delete the row AS THE CALLER — RLS (gposts_own_delete: author ∨ admin ∨
      // gallery.moderate) is the only permission logic. return=representation tells
      // us the image_path iff a row was actually removed.
      const dr = await fetch(`${SB}/rest/v1/gallery_posts?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { apikey: SRK, Authorization: req.headers.get("Authorization")!, Prefer: "return=representation" },
      });
      const rows = dr.ok ? await dr.json() : [];
      if (!Array.isArray(rows) || !rows.length) return json({ error: "not found" }, 404);
      const key = rows[0].image_path;
      if (typeof key === "string" && KEY_RE.test(key)) {
        await r2.fetch(`${R2_BASE}/${key}`, { method: "DELETE" }).catch(() => {});
      }
      return json({ ok: true });
    }

    return json({ error: "unknown op" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
