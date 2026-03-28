/**
 * Private Podcast Worker
 * - Serves RSS feed and audio files from a private R2 bucket
 * - Enforces HTTP Basic Auth on every request
 *
 * Setup:
 *  1. Create a private R2 bucket (e.g. "podcast-files")
 *  2. Bind it to this Worker as BUCKET (see wrangler.toml)
 *  3. Set USERS secret via: wrangler secret put USERS
 *     Value must be a JSON string: {"alice":"pass1","bob":"pass2"}
 *  4. Upload your feed.xml and .mp3 files to the R2 bucket
 */

export default {
  async fetch(request, env) {
    // ── 1. Basic Auth check ──────────────────────────────────────────────────
    const authResult = authenticate(request, env);
    if (!authResult.ok) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Private Podcast"',
        },
      });
    }

    // ── 2. Route the request ─────────────────────────────────────────────────
    const url = new URL(request.url);

    // Strip leading slash to get the R2 object key
    // e.g. /feed.xml         → feed.xml
    //      /episodes/ep1.mp3 → episodes/ep1.mp3
    const key = decodeURIComponent(url.pathname.replace(/^\//, ""));

    if (!key) {
      return new Response("Not Found", { status: 404 });
    }

    // ── 3. Fetch from R2 ─────────────────────────────────────────────────────
    const object = await env.BUCKET.get(key);

    if (!object) {
      return new Response("Not Found", { status: 404 });
    }

    // ── 4. Handle range requests (required for podcast apps to seek audio) ───
    const rangeHeader = request.headers.get("Range");

    if (rangeHeader && object.size) {
      const [, rangeValue] = rangeHeader.split("=");
      const [startStr, endStr] = rangeValue.split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : object.size - 1;
      const chunkSize = end - start + 1;

      // Re-fetch with range
      const rangedObject = await env.BUCKET.get(key, {
        range: { offset: start, length: chunkSize },
      });

      if (!rangedObject) {
        return new Response("Range Not Satisfiable", { status: 416 });
      }

      return new Response(rangedObject.body, {
        status: 206,
        headers: {
          "Content-Type": contentType(key),
          "Content-Range": `bytes ${start}-${end}/${object.size}`,
          "Content-Length": String(chunkSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }

    // ── 5. Normal (non-range) response ───────────────────────────────────────
    const headers = {
      "Content-Type": contentType(key),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };

    if (object.size) {
      headers["Content-Length"] = String(object.size);
    }

    return new Response(object.body, { status: 200, headers });
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validates HTTP Basic Auth credentials against the USERS secret.
 * USERS must be a JSON-encoded object: { "username": "password", ... }
 */
function authenticate(request, env) {
  const authHeader = request.headers.get("Authorization") || "";

  if (!authHeader.startsWith("Basic ")) {
    return { ok: false };
  }

  let users;
  try {
    users = JSON.parse(env.USERS);
  } catch {
    console.error("USERS secret is not valid JSON");
    return { ok: false };
  }

  const base64 = authHeader.slice("Basic ".length);
  const decoded = atob(base64);
  const colonIndex = decoded.indexOf(":");
  if (colonIndex === -1) return { ok: false };

  const username = decoded.slice(0, colonIndex);
  const password = decoded.slice(colonIndex + 1);

  if (users[username] && users[username] === password) {
    return { ok: true, username };
  }

  return { ok: false };
}

/**
 * Returns a Content-Type based on file extension.
 */
function contentType(key) {
  if (key.endsWith(".xml") || key.endsWith(".rss")) return "application/rss+xml; charset=utf-8";
  if (key.endsWith(".mp3")) return "audio/mpeg";
  if (key.endsWith(".m4a") || key.endsWith(".mp4")) return "audio/mp4";
  if (key.endsWith(".ogg")) return "audio/ogg";
  if (key.endsWith(".opus")) return "audio/ogg; codecs=opus";
  return "application/octet-stream";
}
