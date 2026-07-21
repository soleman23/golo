# Other Supabase Auth Email Templates (Golo Golf)

Paste each block into **Authentication → Email Templates** in the Supabase dashboard.
Confirm signup lives in [`supabase-confirm-signup-golo.html`](./supabase-confirm-signup-golo.html).

All templates share the same Variation A look: dark turf, lime CTA (`#d4f23a` / `#13250a`), GoLo wordmark.

**Do not** enable SMTP provider click tracking — it rewrites `{{ .ConfirmationURL }}` and breaks auth.

---

## Shared shell notes

- Table layout + inline styles only
- Keep every `{{ .… }}` variable exactly as written
- Subject lines are suggestions; adjust tone if you want shorter inbox previews

---

## 1. Magic link

**Subject:** Your Golo Golf sign-in link

**Body (HTML):**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Sign in to Golo Golf</title>
</head>
<body style="margin:0;padding:0;background-color:#0c0f12;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0c0f12;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#112318;border:1px solid rgba(255,255,255,0.12);border-radius:18px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:22px 28px;border-bottom:1px solid rgba(255,255,255,0.08);background-color:#0a160f;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.02em;line-height:1;">
                    <span style="color:#ffffff;">Go</span><span style="color:#d4f23a;">Lo</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 36px 28px;background-color:#112318;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#d4f23a;">Magic link</p>
              <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;line-height:1.15;letter-spacing:-0.02em;color:#ffffff;">Sign in to Golo Golf</h1>
              <p style="margin:0 0 28px;font-size:16px;line-height:1.55;color:rgba(255,255,255,0.72);">
                Use this one-time link to sign in as <strong style="color:#ffffff;">{{ .Email }}</strong>. It expires soon — request a new one if it doesn’t work.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
                <tr>
                  <td align="center" bgcolor="#d4f23a" style="border-radius:14px;background-color:#d4f23a;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:16px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#13250a;text-decoration:none;border-radius:14px;">Sign in →</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.45);">Or paste this link</p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;">
                <a href="{{ .ConfirmationURL }}" style="color:#d4f23a;text-decoration:underline;">{{ .ConfirmationURL }}</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.5;color:rgba(255,255,255,0.45);">If you didn’t request this, you can ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px 28px;border-top:1px solid rgba(255,255,255,0.08);background-color:#0a160f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.4);text-align:center;">Sent by Golo Golf · account security</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 2. Reset password

**Subject:** Reset your Golo Golf password

**Body (HTML):**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Reset your Golo Golf password</title>
</head>
<body style="margin:0;padding:0;background-color:#0c0f12;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0c0f12;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#112318;border:1px solid rgba(255,255,255,0.12);border-radius:18px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:22px 28px;border-bottom:1px solid rgba(255,255,255,0.08);background-color:#0a160f;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.02em;line-height:1;">
                    <span style="color:#ffffff;">Go</span><span style="color:#d4f23a;">Lo</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 36px 28px;background-color:#112318;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#d4f23a;">Password reset</p>
              <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;line-height:1.15;letter-spacing:-0.02em;color:#ffffff;">Reset your password</h1>
              <p style="margin:0 0 28px;font-size:16px;line-height:1.55;color:rgba(255,255,255,0.72);">
                We got a request to reset the password for <strong style="color:#ffffff;">{{ .Email }}</strong>. Tap below to choose a new one.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
                <tr>
                  <td align="center" bgcolor="#d4f23a" style="border-radius:14px;background-color:#d4f23a;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:16px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#13250a;text-decoration:none;border-radius:14px;">Reset password →</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.45);">Or paste this link</p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;">
                <a href="{{ .ConfirmationURL }}" style="color:#d4f23a;text-decoration:underline;">{{ .ConfirmationURL }}</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.5;color:rgba(255,255,255,0.45);">If you didn’t ask to reset your password, you can ignore this email — your password stays the same.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px 28px;border-top:1px solid rgba(255,255,255,0.08);background-color:#0a160f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.4);text-align:center;">Sent by Golo Golf · account security</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 3. Invite user

**Subject:** You’re invited to Golo Golf

**Body (HTML):**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>You’re invited to Golo Golf</title>
</head>
<body style="margin:0;padding:0;background-color:#0c0f12;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0c0f12;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#112318;border:1px solid rgba(255,255,255,0.12);border-radius:18px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:22px 28px;border-bottom:1px solid rgba(255,255,255,0.08);background-color:#0a160f;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.02em;line-height:1;">
                    <span style="color:#ffffff;">Go</span><span style="color:#d4f23a;">Lo</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 36px 28px;background-color:#112318;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#d4f23a;">Invitation</p>
              <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;line-height:1.15;letter-spacing:-0.02em;color:#ffffff;">You’re invited</h1>
              <p style="margin:0 0 28px;font-size:16px;line-height:1.55;color:rgba(255,255,255,0.72);">
                You’ve been invited to join Golo Golf as <strong style="color:#ffffff;">{{ .Email }}</strong>. Accept the invite to set your password and get on the course.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
                <tr>
                  <td align="center" bgcolor="#d4f23a" style="border-radius:14px;background-color:#d4f23a;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:16px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#13250a;text-decoration:none;border-radius:14px;">Accept invite →</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.45);">Or paste this link</p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;">
                <a href="{{ .ConfirmationURL }}" style="color:#d4f23a;text-decoration:underline;">{{ .ConfirmationURL }}</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.5;color:rgba(255,255,255,0.45);">If you weren’t expecting this invite, you can ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px 28px;border-top:1px solid rgba(255,255,255,0.08);background-color:#0a160f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.4);text-align:center;">Sent by Golo Golf</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 4. Change email address (Confirm email change)

Supabase labels this template **Change Email Address** (or similar). It confirms the **new** address.

**Subject:** Confirm your new email for Golo Golf

**Body (HTML):**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Confirm your new email</title>
</head>
<body style="margin:0;padding:0;background-color:#0c0f12;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0c0f12;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#112318;border:1px solid rgba(255,255,255,0.12);border-radius:18px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:22px 28px;border-bottom:1px solid rgba(255,255,255,0.08);background-color:#0a160f;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.02em;line-height:1;">
                    <span style="color:#ffffff;">Go</span><span style="color:#d4f23a;">Lo</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 36px 28px;background-color:#112318;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#d4f23a;">Email change</p>
              <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;line-height:1.15;letter-spacing:-0.02em;color:#ffffff;">Confirm your new email</h1>
              <p style="margin:0 0 28px;font-size:16px;line-height:1.55;color:rgba(255,255,255,0.72);">
                Confirm <strong style="color:#ffffff;">{{ .NewEmail }}</strong> as the new email on your Golo Golf account.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
                <tr>
                  <td align="center" bgcolor="#d4f23a" style="border-radius:14px;background-color:#d4f23a;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:16px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#13250a;text-decoration:none;border-radius:14px;">Confirm new email →</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.45);">Or paste this link</p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;">
                <a href="{{ .ConfirmationURL }}" style="color:#d4f23a;text-decoration:underline;">{{ .ConfirmationURL }}</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.5;color:rgba(255,255,255,0.45);">If you didn’t request an email change, ignore this message and keep using your current address.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px 28px;border-top:1px solid rgba(255,255,255,0.08);background-color:#0a160f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.4);text-align:center;">Sent by Golo Golf · account security</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## Quick paste checklist

| Supabase template | Subject | Primary CTA |
|-------------------|---------|-------------|
| Confirm signup | Confirm your Golo Golf account | Confirm email → |
| Magic Link | Your Golo Golf sign-in link | Sign in → |
| Reset Password | Reset your Golo Golf password | Reset password → |
| Invite User | You’re invited to Golo Golf | Accept invite → |
| Change Email Address | Confirm your new email for Golo Golf | Confirm new email → |

Setup steps (Resend, DNS, SMTP): [../supabase-auth-email-setup.md](../supabase-auth-email-setup.md).
