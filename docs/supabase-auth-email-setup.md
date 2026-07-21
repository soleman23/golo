# Supabase Auth Email Setup (Golo Golf)

Production auth emails should come from **Golo Golf**, not the default Supabase sender. This guide wires **Resend** SMTP + branded templates for `golo.golf`.

**Recommended sender**

| Field | Value |
|-------|--------|
| From email | `no-reply@auth.golo.golf` |
| From name | `Golo Golf` |
| Auth subdomain | `auth.golo.golf` |

Templates live in [`email-templates/`](./email-templates/).

---

## Why custom SMTP

Supabase’s built-in mailer is for **development only**. It has low rate limits, a generic From address, and weak deliverability. Production needs:

1. A verified domain you control (`golo.golf`)
2. An SMTP provider (this guide uses **Resend**)
3. Custom HTML templates under **Authentication → Email Templates**

---

## 1. Create a Resend account and verify the domain

1. Sign up at [resend.com](https://resend.com).
2. Go to **Domains → Add Domain**.
3. Add **`auth.golo.golf`** (preferred) so auth mail is isolated from marketing/support mail on the apex domain.
   You can also verify apex `golo.golf` if you prefer one domain for everything — then still send from `no-reply@auth.golo.golf` only after that subdomain is allowed by Resend’s DNS records.
4. Resend shows DNS records to add at your DNS host (Cloudflare, Namecheap, Google Domains, etc.).

### DNS checklist

Add exactly what Resend shows. Conceptually you need:

| Record | Purpose |
|--------|---------|
| **SPF** (TXT) | Authorizes Resend to send for the domain |
| **DKIM** (TXT / CNAME) | Cryptographic signing so inboxes trust the message |
| **DMARC** (TXT, optional but recommended) | Policy for failed SPF/DKIM — start with `v=DMARC1; p=none;` then tighten later |

Wait until Resend marks the domain **Verified** before enabling SMTP in Supabase.

### Critical: do not rewrite auth links

In Resend (and any click-tracking feature):

- **Disable** open/click tracking that rewrites URLs.
- Supabase confirmation and reset links must stay as Supabase-issued URLs. Rewritten links break auth.

---

## 2. Create Resend SMTP credentials

In Resend:

1. Create an **API key** with send permission (or use SMTP credentials if Resend shows a dedicated SMTP password).
2. Note these values for Supabase:

| Setting | Typical Resend value |
|---------|----------------------|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) or `587` (STARTTLS) |
| Username | `resend` |
| Password | your Resend API key |

Confirm the current host/port in Resend’s docs if the UI differs.

---

## 3. Configure Supabase custom SMTP

In the Supabase dashboard:

**Project Settings → Authentication → SMTP Settings** (path may read **Authentication → SMTP** depending on UI version)

| Field | Value |
|-------|--------|
| Enable custom SMTP | On |
| Sender email | `no-reply@auth.golo.golf` |
| Sender name | `Golo Golf` |
| Host | `smtp.resend.com` |
| Port | `465` or `587` |
| Username | `resend` |
| Password | Resend API key |

Save. Do not commit SMTP passwords to the repo.

---

## 4. Paste branded email templates

**Authentication → Email Templates**

| Template | Source |
|----------|--------|
| Confirm signup | [`email-templates/supabase-confirm-signup-golo.html`](./email-templates/supabase-confirm-signup-golo.html) |
| Magic link, Reset password, Invite, Change email | [`email-templates/supabase-other-auth-templates.md`](./email-templates/supabase-other-auth-templates.md) |

For each template:

1. Set the **Subject** from the matching section in the docs.
2. Paste the **HTML body** into the template editor.
3. Keep every `{{ .… }}` variable exactly as written — Supabase fills them at send time.

---

## 5. Auth URL configuration (required for links)

Confirmation and reset links redirect using your Site URL settings.

**Authentication → URL Configuration**

- **Site URL:** your production app (e.g. `https://gologolf.netlify.app` or your custom domain)
- **Redirect URLs:** include `https://YOUR-SITE/**` and `http://localhost:5173/**` for local testing

See also [README.md](../README.md) and [LAUNCH.md](./LAUNCH.md).

---

## 6. Confirm email ON vs OFF

**Authentication → Providers → Email → Confirm email**

| Phase | Recommendation |
|-------|----------------|
| Setting up SMTP + templates | Leave OFF or use a throwaway test user; send a test after SMTP is live |
| Production (branded mail working) | Turn **ON** |
| Crew / event weekend (max speed) | OFF is fine for friction; reset-password emails still use SMTP |

Practical order: **Resend + templates → test one confirm email → then turn Confirm email ON.**

---

## 7. Testing checklist

- [ ] Resend domain status is **Verified**
- [ ] Supabase SMTP enabled with `no-reply@auth.golo.golf` / `Golo Golf`
- [ ] Confirm signup template pasted; `{{ .ConfirmationURL }}` unchanged
- [ ] Site URL + Redirect URLs match the live app
- [ ] Sign up a new test account → email arrives from **Golo Golf** `<no-reply@auth.golo.golf>`
- [ ] Confirm link opens the app and completes signup (not a 404 / wrong host)
- [ ] Check spam/junk once; if filtered, wait for SPF/DKIM/DMARC to fully propagate
- [ ] Forgot password → reset email arrives and link works
- [ ] Resend click tracking is **off**

---

## Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| Still from `supabase.co` / noreply@supabase | Custom SMTP not enabled or not saved |
| Domain not verified in Resend | DNS not propagated; re-check SPF/DKIM |
| Link opens Resend/tracking URL and auth fails | Disable click tracking |
| Link goes to wrong site | Fix Site URL / Redirect URLs |
| Email never arrives | Check Resend logs; verify sender domain matches verified domain |

---

## Repo files

```
docs/
  supabase-auth-email-setup.md          ← this guide
  email-templates/
    supabase-confirm-signup-golo.html   ← Confirm signup (paste into Supabase)
    supabase-other-auth-templates.md    ← Magic link, reset, invite, change email
```
