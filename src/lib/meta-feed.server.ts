// Shared helpers for the live Meta (Facebook + Instagram Shop) catalog feed.
// Feed URLs are signed per-user with an HMAC so they can be public yet unguessable.

async function hmacHex(message: string, secret: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`meta-feed:${message}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function feedSecret() {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Feed signing secret unavailable");
  return s;
}

export async function signFeedToken(userId: string) {
  return hmacHex(userId, feedSecret());
}

export async function verifyFeedToken(userId: string, token: string) {
  const expected = await signFeedToken(userId);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
