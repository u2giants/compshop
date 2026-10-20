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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const appSecret = Deno.env.get("WECHAT_APP_SECRET");
  const appId = Deno.env.get("WECHAT_APP_ID") || "wx15bb6cd1fa50ff83";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
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
  const tokenRes = await fetch(tokenUrl);
  const tokenBody = await tokenRes.json();
  if (tokenBody.errcode || !tokenBody.access_token) {
    return json({ error: tokenBody.errmsg || "WeChat token exchange failed" }, 401);
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
    const infoRes = await fetch(
      `${WECHAT_USERINFO_URL}?access_token=${encodeURIComponent(wechatAccessToken)}&openid=${encodeURIComponent(openid)}&lang=zh_CN`,
    );
    const info = await infoRes.json();
    if (!info.errcode) {
      nickname = String(info.nickname || "");
      avatarUrl = String(info.headimgurl || "");
    }
  } catch {
    // profile is optional for sign-in
  }

  const identityKey = unionid || openid;
  const email = wechatEmail(unionid, openid);

  // Admin client for user lookup / create / session
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId = "";
  const { data: found, error: findError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (findError) {
    return json({ error: "Could not look up user" }, 500);
  }
  const existing = (found?.users ?? []).find((u) => {
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const appMeta = (u.app_metadata ?? {}) as Record<string, unknown>;
    return (
      u.email === email ||
      meta.wechat_unionid === identityKey ||
      meta.wechat_openid === openid ||
      appMeta.wechat_unionid === identityKey
    );
  });

  if (existing?.id) {
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        display_name: nickname || existing.user_metadata?.display_name || "",
        avatar_url: avatarUrl || existing.user_metadata?.avatar_url || "",
        wechat_openid: openid,
        wechat_unionid: unionid || identityKey,
      },
      app_metadata: {
        ...(existing.app_metadata ?? {}),
        provider: "wechat",
        providers: Array.from(new Set([...((existing.app_metadata?.providers as string[]) ?? []), "wechat"])),
        provider_id: identityKey,
      },
    });
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
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
    });
    if (createError || !created?.user) {
      return json({ error: createError?.message || "Could not create user" }, 500);
    }
    userId = created.user.id;
  }

  // 3) mint a one-time magic-link session, then hand tokens to the SPA
  const siteUrl = Deno.env.get("SITE_URL") || "https://comp.designflow.app";
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: siteUrl },
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    return json({ error: linkError?.message || "Could not create session" }, 500);
  }

  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      type: "magiclink",
      token_hash: linkData.properties.hashed_token,
    }),
  });
  const verifyBody = await verifyRes.json();
  if (!verifyRes.ok || !verifyBody.access_token) {
    return json({ error: verifyBody?.msg || verifyBody?.error_description || "Session verify failed" }, 500);
  }

  return json({
    access_token: verifyBody.access_token,
    refresh_token: verifyBody.refresh_token,
    expires_in: verifyBody.expires_in,
    expires_at: verifyBody.expires_at,
    token_type: verifyBody.token_type || "bearer",
    user: { id: userId, email },
  });
});
