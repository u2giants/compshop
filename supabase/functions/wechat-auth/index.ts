/**
 * WeChat website-app SSO bridge.
 *
 * WeChat (qrconnect) returns an authorization `code` on the designflow.app
 * bounce URL, which forwards here. This function:
 *   1. exchanges the code at WeChat (appid/secret, GET, non-standard OAuth)
 *   2. finds or creates a Supabase user keyed by unionid (stable across apps)
 *   3. mints a normal Supabase session for the SPA
 *
 * Invite-only still applies: the profiles trigger marks unknown users pending.
 *
 * Uses GoTrue admin REST directly (no remote JS imports) so cold starts and
 * Hostdare network flaps cannot hang the isolate.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WECHAT_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token";
const WECHAT_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function wechatEmail(unionid: string, openid: string) {
  const key = (unionid || openid).toLowerCase();
  return `wx_${key}@wechat.local`;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 12000) {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, body };
}

function adminHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const appSecret = Deno.env.get("WECHAT_APP_SECRET");
  const appId = Deno.env.get("WECHAT_APP_ID") || "wx15bb6cd1fa50ff83";
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!appSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "WeChat SSO is not configured on the server." }, 500);
  }

  let code = "";
  try {
    const body = await req.json();
    code = String(body?.code ?? "");
  } catch {
    code = new URL(req.url).searchParams.get("code") ?? "";
  }
  if (!code) {
    return json({ error: "Missing WeChat code" }, 400);
  }

  // 1) code → WeChat access token + openid/unionid
  const tokenUrl =
    `${WECHAT_TOKEN_URL}?appid=${encodeURIComponent(appId)}` +
    `&secret=${encodeURIComponent(appSecret)}` +
    `&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  let tokenBody: Record<string, unknown>;
  try {
    const tokenRes = await fetchJson(tokenUrl, {}, 10000);
    tokenBody = tokenRes.body;
  } catch (err) {
    return json({ error: `WeChat token request failed: ${err instanceof Error ? err.message : "timeout"}` }, 502);
  }
  if (tokenBody.errcode || !tokenBody.access_token) {
    return json({ error: String(tokenBody.errmsg || "WeChat token exchange failed") }, 401);
  }

  const openid = String(tokenBody.openid || "");
  const unionid = String(tokenBody.unionid || "");
  const wechatAccessToken = String(tokenBody.access_token || "");
  if (!openid) {
    return json({ error: "WeChat did not return openid" }, 401);
  }

  // 2) profile (nickname / avatar). Best-effort — avatar URLs expire.
  let nickname = "";
  let avatarUrl = "";
  try {
    const infoRes = await fetchJson(
      `${WECHAT_USERINFO_URL}?access_token=${encodeURIComponent(wechatAccessToken)}&openid=${encodeURIComponent(openid)}&lang=zh_CN`,
      {},
      8000,
    );
    const info = infoRes.body;
    if (!info.errcode) {
      nickname = String(info.nickname || "");
      avatarUrl = String(info.headimgurl || "");
    }
  } catch {
    // profile is optional for sign-in
  }

  const identityKey = unionid || openid;
  const email = wechatEmail(unionid, openid);
  const headers = adminHeaders(serviceRoleKey);

  // Find existing user by synthetic email (deterministic per unionid).
  let userId = "";
  let existingMeta: Record<string, unknown> = {};
  let existingAppMeta: Record<string, unknown> = {};

  let listBody: Record<string, unknown> = {};
  try {
    const listRes = await fetchJson(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, {
      headers,
    }, 15000);
    if (!listRes.ok) {
      return json({
        error: `User lookup failed (${listRes.status}): ${JSON.stringify(listRes.body).slice(0, 200)}`,
      }, 500);
    }
    listBody = listRes.body;
  } catch (err) {
    return json({ error: `User lookup failed: ${err instanceof Error ? err.message : "timeout"}` }, 500);
  }

  const users = Array.isArray(listBody.users) ? listBody.users : [];
  const existing = users.find((u: Record<string, unknown>) => {
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const appMeta = (u.app_metadata ?? {}) as Record<string, unknown>;
    return (
      u.email === email ||
      meta.wechat_unionid === identityKey ||
      meta.wechat_openid === openid ||
      appMeta.wechat_unionid === identityKey
    );
  });

  const userMetadata = {
    display_name: nickname || "WeChat user",
    avatar_url: avatarUrl,
    wechat_openid: openid,
    wechat_unionid: unionid || identityKey,
  };
  const appMetadata = {
    provider: "wechat",
    providers: ["wechat"],
    provider_id: identityKey,
  };

  if (existing && typeof existing.id === "string") {
    userId = existing.id;
    existingMeta = (existing.user_metadata ?? {}) as Record<string, unknown>;
    existingAppMeta = (existing.app_metadata ?? {}) as Record<string, unknown>;
    try {
      const upd = await fetchJson(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          user_metadata: {
            ...existingMeta,
            display_name: nickname || existingMeta.display_name || "",
            avatar_url: avatarUrl || existingMeta.avatar_url || "",
            wechat_openid: openid,
            wechat_unionid: unionid || identityKey,
          },
          app_metadata: {
            ...existingAppMeta,
            provider: "wechat",
            providers: Array.from(
              new Set([...(((existingAppMeta.providers as string[]) ?? [])), "wechat"]),
            ),
            provider_id: identityKey,
          },
        }),
      }, 15000);
      if (!upd.ok) {
        return json({ error: `User update failed (${upd.status}): ${JSON.stringify(upd.body).slice(0, 200)}` }, 500);
      }
    } catch (err) {
      return json({ error: `User update failed: ${err instanceof Error ? err.message : "timeout"}` }, 500);
    }
  } else {
    try {
      const createRes = await fetchJson(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          email_confirm: true,
          user_metadata: {
            display_name: nickname || "WeChat user",
            avatar_url: avatarUrl,
            wechat_openid: openid,
            wechat_unionid: unionid || identityKey,
          },
          app_metadata: {
            provider: "wechat",
            providers: ["wechat"],
            provider_id: identityKey,
          },
        }),
      }, 15000);
      if (!createRes.ok || !(createRes.body as { id?: string }).id) {
        return json({
          error: `User create failed (${createRes.status}): ${JSON.stringify(createRes.body).slice(0, 200)}`,
        }, 500);
      }
      userId = String((createRes.body as { id?: string }).id);
    } catch (err) {
      return json({ error: `User create failed: ${err instanceof Error ? err.message : "timeout"}` }, 500);
    }
  }

  // 3) mint a one-time magic-link session, then hand tokens to the SPA
  const siteUrl = Deno.env.get("SITE_URL") || "https://comp.designflow.app";
  let hashedToken = "";
  try {
    const linkRes = await fetchJson(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "magiclink",
        email,
        options: { redirectTo: siteUrl },
      }),
    }, 15000);
    const linkBody = linkRes.body as {
      hashed_token?: string;
      properties?: { hashed_token?: string };
    };
    hashedToken = String(linkBody?.hashed_token || linkBody?.properties?.hashed_token || "");
    if (!linkRes.ok || !hashedToken) {
      return json({
        error: `Session create failed (${linkRes.status}): ${JSON.stringify(linkRes.body).slice(0, 200)}`,
      }, 500);
    }
  } catch (err) {
    return json({ error: `Session create failed: ${err instanceof Error ? err.message : "timeout"}` }, 500);
  }

  try {
    const verifyRes = await fetchJson(`${supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        type: "magiclink",
        token_hash: hashedToken,
      }),
    }, 15000);
    const verifyBody = verifyRes.body as Record<string, unknown>;
    if (!verifyRes.ok || !verifyBody.access_token) {
      return json({
        error: String(
          verifyBody.msg || verifyBody.error_description || verifyBody.error ||
            `Session verify failed (${verifyRes.status})`,
        ),
      }, 500);
    }

    return json({
      access_token: verifyBody.access_token,
      refresh_token: verifyBody.refresh_token,
      expires_in: verifyBody.expires_in,
      expires_at: verifyBody.expires_at,
      token_type: verifyBody.token_type || "bearer",
      user: { id: userId, email },
    });
  } catch (err) {
    return json({ error: `Session verify failed: ${err instanceof Error ? err.message : "timeout"}` }, 500);
  }
});
