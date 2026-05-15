# Authentik — Identity Provider Configuration

Authentik runs at `https://auth.designflow.app` (self-hosted on the Tencent Cloud VPS via Coolify).
It is the single identity provider for all apps: CompShop, Twenty CRM, HiClaw, PopDAM, and Coolify itself.

Admin UI: `https://auth.designflow.app/if/admin/`  
API base: `https://auth.designflow.app/api/v3/`

---

## Login methods (all four must be configured)

| Method | How it works | Who can use it |
|---|---|---|
| **Microsoft 365 SSO** | OAuth2 source → Azure AD tenant | Anyone with an M365 account in your tenant |
| **Google OAuth** | OAuth2 source → Google | Anyone with a Google account in your org |
| **Active Directory (LDAP)** | LDAP source → on-prem AD at `ldap://100.107.131.35:10389` | AD users in `OU=AlbertHazan,OU=IML` only |
| **Local credentials** | Authentik built-in user store | Accounts created directly in Authentik |

Users who authenticate via LDAP or local credentials use the username + password flow (no SSO button). Microsoft 365 and Google appear as buttons on the Authentik login page.

---

## LDAP Source (Active Directory)

The AD is shared with Isaac Morris (a much larger company). **The scope must be restricted** or Authentik will sync thousands of Isaac Morris accounts.

| Setting | Value |
|---|---|
| Server URI | `ldap://100.107.131.35:10389` |
| Base DN | `DC=iml,DC=isaacmorris,DC=com` |
| Bind CN | `CN=Edge authentik svc account,OU=popcreations,OU=AlbertHazan,OU=IML,DC=iml,DC=isaacmorris,DC=com` |
| **Additional User DN** | `OU=AlbertHazan,OU=IML` ← **critical** — without this all ~2,500 Isaac Morris users sync in |
| **Additional Group DN** | `OU=AlbertHazan,OU=IML` |
| Object uniqueness field | `objectSid` |
| Sync schedule | `24 */2 * * *` (every 2 hours at :24) |

Your users sit in `OU=popcreations,OU=AlbertHazan,OU=IML` and `OU=AlbertHazan.com,OU=AlbertHazan,OU=IML`. A handful of users (`jhazan`, `hazan`, `ihazan`) are in `OU=Users,OU=IML` — those are outside the scope and will not sync.

**Note:** The on-prem AD and the M365 tenant are separate — they do not share accounts or email addresses. A user logging in via M365 SSO and the same person logging in via LDAP will appear as two different Authentik accounts unless manually linked.

To trigger a manual sync:
```bash
curl -X POST https://auth.designflow.app/api/v3/sources/ldap/active-directory/sync/ \
  -H "Authorization: Bearer <api-token>"
```

---

## OAuth2 Providers — required settings for every app

Every application that uses Authentik SSO needs its own OAuth2/OpenID provider. **Two settings are mandatory** — missing either one causes an `insufficient_scope` error in the app:

| Setting | Required value |
|---|---|
| **Property mappings** | `openid`, `email`, `profile` (all three must be attached) |
| **Signing key** | `authentik Internal JWT Certificate` |

Current providers and their application assignments:

| Provider | App | Notes |
|---|---|---|
| CompShop | CompShop | Redirect URI: `https://api.comp.designflow.app/auth/v1/callback` |
| Twenty CRM | Twenty CRM | |
| twenty-crm | Twenty CRM | Duplicate — both fixed; prefer the one assigned to the application |
| HiClaw | HiClaw | |
| PopDAM | PopDAM | |
| Coolify | Coolify | |

When creating a new provider:
1. Authentik admin → **Applications → Providers → Create → OAuth2/OpenID Provider**
2. Set signing key and all three scope mappings before saving
3. Create the Application and link it to the provider

---

## Branding

A version string is injected into every Authentik screen via **System → Brands → default → Custom CSS**:

```css
body::after {
  content: "authentik 2026.2.2 · cfg <date>: <summary of last change>";
  position: fixed;
  top: 6px;
  right: 10px;
  z-index: 9999;
  font-family: monospace;
  font-size: 11px;
  color: rgba(120,120,120,0.7);
  pointer-events: none;
  white-space: nowrap;
}
```

**Update this string whenever you make configuration changes to Authentik**, so anyone looking at a login screen can tell what version of config is running.

To update via API:
```bash
curl -X PATCH https://auth.designflow.app/api/v3/core/brands/9f76e935-5c44-4ea4-a15c-1254c7cdac0e/ \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  -d '{"branding_custom_css": "body::after { content: \"authentik 2026.2.2 · cfg YYYY-MM-DD: <summary>\"; position: fixed; top: 6px; right: 10px; z-index: 9999; font-family: monospace; font-size: 11px; color: rgba(120,120,120,0.7); pointer-events: none; white-space: nowrap; }"}'
```

---

## API access

A long-lived admin API token exists for `akadmin`. Store it in your password manager — do not hardcode it in scripts committed to this repo.

The token can be found in Authentik admin → **System → Tokens** or retrieved via the Django shell on the VPS:
```bash
sudo docker exec server-zm80q1kbos0k8q0tlhyzsrs0 ak shell -c "
from authentik.core.models import Token
print(Token.objects.get(user__username='akadmin', expires__isnull=True).key)
"
```

---

## VPS access

Authentik runs as containers managed by Coolify on the Tencent Cloud VPS.

| | Value |
|---|---|
| Public IP | `43.173.75.208` |
| Tailscale IP | `100.108.138.66` |
| SSH | `ssh -i ~/.ssh/migration_key ai@100.108.138.66` |
| Server container | `server-zm80q1kbos0k8q0tlhyzsrs0` |
| Worker container | `worker-zm80q1kbos0k8q0tlhyzsrs0` |
| DB container | `postgresql-zm80q1kbos0k8q0tlhyzsrs0` |
