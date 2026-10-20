# WeChat SSO playbook (for this app and the next one)

How CompShop added WeChat website login, and how to repeat it for another
application. Owner: POP Creations. Last updated 2026-10-20.

Related code (CompShop):

- `src/pages/Auth.tsx` — Continue with WeChat button (starts `qrconnect`)
- `src/pages/WeChatCallback.tsx` — receives `code`, calls the bridge
- `supabase/functions/wechat-auth/index.ts` — code exchange + session
- `supabase/migrations/20261020000000_wechat_sso_access_rules.sql` — allows `wechat` in access rules
- `docs/wechat-sso-investigation.md` — console findings and design decisions

Related code (DesignFlow frontend, serves the bounce):

- `src/wx/callback/index.html` — forwards `code` to the target app
- `nginx.conf` — `/wx/callback` → `/wx/callback/`

---

## 1. What WeChat will and will not do

| Fact | Detail |
|------|--------|
| Product | WeChat Open Platform **网站应用** (website app) + **微信登录** capability |
| CompShop AppID | `wx15bb6cd1fa50ff83` (POP Creations) |
| 授权回调域 (authorized callback domain) | **`designflow.app` only** — subdomains like `comp.designflow.app` are rejected |
| Protocol | OAuth2 authorization-code, **not** OIDC |
| Authorize URL | `https://open.weixin.qq.com/connect/qrconnect?appid=…&redirect_uri=…&response_type=code&scope=snsapi_login&state=…#wechat_redirect` |
| Token URL | `GET https://api.weixin.qq.com/sns/oauth2/access_token?appid=…&secret=…&code=…&grant_type=authorization_code` |
| User info | `GET https://api.weixin.qq.com/sns/userinfo?access_token=…&openid=…` |
| Email | **None.** Do not invent a real mailbox. |
| Stable user key | **`unionid`** (same person across future mini-program / official-account apps). Keep `openid` too. |
| PKCE | Not supported. |
| Token exchange vs redirect_uri | WeChat does **not** re-check `redirect_uri` when exchanging `code` — a bounce is safe. |

## 2. Architecture we shipped

```
User → Continue with WeChat
     → open.weixin.qq.com/qrconnect  (redirect_uri = https://designflow.app/wx/callback/)
     → designflow.app/wx/callback/   (static bounce; keeps ?code=&state=)
     → comp.designflow.app/auth/wechat/callback
     → edge function wechat-auth
         exchange code → openid/unionid
         find or create Supabase user
         mint Supabase session
     → SPA setSession → normal AuthContext / approval rules
```

Why the bounce: WeChat only accepts `designflow.app` as the callback host.
CompShop lives on `comp.designflow.app`. The bounce is one static HTML file.

**Use the trailing slash:** `https://designflow.app/wx/callback/`  
Without the slash, nginx serves the SPA instead of the bounce.

## 3. Steps for a new application

### A. WeChat console (once per website app)

1. Log in to https://open.weixin.qq.com (admin WeChat, QR).
2. 管理中心 → **网站应用** → create or open the app.
3. 能力专区 → apply for / confirm **微信登录** is **已获得**.
4. 开发配置 → 域名信息 → **授权回调域** = the **exact host** that will receive `code`
   (for CompShop that is `designflow.app`).
5. Keep **AppID** public; put **AppSecret** in 1Password vault `vibe_coding` only.
   Generating AppSecret needs the admin WeChat QR. The secret is shown **once**.

### B. Bounce page on the authorized domain

If the app cannot live on the authorized domain, add a bounce (DesignFlow already has one):

- Path: `/wx/callback/` (and no-slash redirect if possible)
- Body: `location.replace("https://<app-host>/auth/wechat/callback" + window.location.search)`
- Do **not** put AppSecret on that page.

### C. Application login code

1. Button → `qrconnect` with `scope=snsapi_login`, `state` = random, `redirect_uri` = bounce URL.
2. Callback route reads `code`, calls a **server-side** bridge (edge function / small API).
3. Bridge:
   - Exchange `code` at WeChat with AppID + AppSecret (server only).
   - Key the user on `unionid` (fallback `openid`).
   - Create/lookup the auth user; store nickname/avatar in metadata.
   - Mint a **normal Supabase session** (or your app’s session). Never trust the SPA with AppSecret.
4. Access control stays app policy (CompShop: invite-only → new users `pending`).

### D. App access rules

- Allow provider `wechat` in whatever allowlist you use (CompShop: `auth_access_rules`).
- WeChat users have no email. CompShop uses synthetic login key `wx_<unionid-or-openid>@wechat.local`.

## 4. How to invite / approve a WeChat user (CompShop)

WeChat does not give you an email, so classic “invite by email” only works if you
already know their synthetic key or a contact email you store yourself.

**Recommended flow (invite-only):**

1. User clicks **Continue with WeChat** once. The system creates their account in **pending**.
2. Admin opens CompShop admin (users / permissions) and **approves** that person.
3. Optional: block others in the same admin screen.

If you must invite **before** first login, you need their WeChat identity first
(e.g. they log in once as pending, or you record `wx_<id>@wechat.local` yourself),
then use the normal invite screen with that address.

Do **not** expect a WeChat user to receive an email invitation at a WeChat address —
WeChat does not provide one.

## 5. Secrets

| Item | Where | Never |
|------|--------|--------|
| AppID | Frontend config OK | — |
| AppSecret | 1Password `vibe_coding` → `wechat SSO appsecret for compshop` | Chat, git, logs, browser, client JS |
| Supabase service role | Coolify / 1Password | Client bundle |

## 6. Do / Do not

**Do**

- Use `https://designflow.app/wx/callback/` (with slash) as `redirect_uri` for CompShop-style apps on this domain.
- Store `unionid` as the account key; keep `openid`.
- Keep invite-only / admin approval if that is product policy.
- Keep AppSecret only on the server that exchanges `code`.
- Test: new user → pending → admin approve; invited/approved → home; blocked → denied.
- Copy WeChat avatar if you show it (avatar URLs expire).

**Do not**

- Do not set WeChat callback to `comp.designflow.app` or any subdomain — WeChat rejects it.
- Do not use Supabase “custom OAuth provider” against WeChat directly (nonstandard token API; CompShop GoTrue was too old anyway).
- Do not generate AppSecret in a shared screenshot or paste it in chat.
- Do not use PKCE params with WeChat.
- Do not invent a real email for WeChat users or mail them at `@wechat.local`.
- Do not rely on `/wx/callback` without a trailing slash unless you added a nginx redirect.
- Do not skip `state` (CSRF).

## 7. CompShop production checklist (as of 2026-10-20)

| Item | State |
|------|--------|
| WeChat 微信登录 approved | Yes |
| AppID / AppSecret in 1Password | Yes |
| Bounce live at `designflow.app/wx/callback/` | **Yes** |
| CompShop button + callback + `wechat-auth` in `main` | **Yes** (merged) |
| Access-rule migration applied to production DB | **Still required** (`supabase/migrations/20261020000000_wechat_sso_access_rules.sql`) |
| `WECHAT_APP_SECRET` set on Supabase/Coolify | **Still required** |
| Frontend rebuild showing WeChat button | Verify after Coolify build |
| Edge functions booting | Troubleshoot `InvalidWorkerCreation` if still failing |

## 8. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| WeChat: 该链接无法访问 | `redirect_uri` host ≠ 授权回调域, or bad `scope` |
| Bounce shows Designflow app | Missing trailing slash |
| Login fails after QR | AppSecret wrong/missing, or `code` reused (one-time, 10 min) |
| User stuck pending | Invite-only; admin must approve |
| `InvalidWorkerCreation` on `/functions/v1/*` | Edge runtime not booting — check Supabase service deploy, not WeChat |
| Session drops after refresh | Session minting does not match Supabase refresh tokens |

## 9. Where this lives on GitHub

- This playbook: `u2giants/compshop` → `docs/wechat-sso-playbook.md`
- Investigation notes: `u2giants/compshop` → `docs/wechat-sso-investigation.md`
- Bounce page: `popcre/designflow-frontend` → `src/wx/callback/index.html`
