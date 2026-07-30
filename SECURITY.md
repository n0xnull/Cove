# Security Policy

## Responsible Disclosure

Cove is a privacy-sensitive project — we take vulnerability reports seriously.

**Do not** report security vulnerabilities via public GitHub Issues.

Instead, email: **security@n0xnull.dev** with the following details:

- Description of the vulnerability and its potential impact
- Steps to reproduce
- Affected component (`agent-android-parental`, `dashboard-web-parental`, Supabase schema, etc.)
- Version or commit hash

We will acknowledge receipt within **72 hours** and coordinate on a fix
and disclosure timeline.

## Scope

| Component | Examples of issues in scope |
|---|---|
| **Android agent** | Data leakage outside the paired Supabase project, unauthorised command execution, bypass of pairing PIN |
| **Web dashboard** | Missing authorization on API routes, IDOR, XSS, exposure of `SERVICE_ROLE_KEY` |
| **Supabase schema / RLS** | Row Level Security misconfiguration that allows cross-child data access |
| **Transport** | Unencrypted sensitive data, key exposure |

## Out of Scope

- Issues that require physical access to the monitored child's device.
- Denial-of-service against self-hosted instances.
- Intentional design trade-offs documented in [README.md](README.md#-security-notes)
  (e.g., dashboard has no built-in auth — this is documented behavior with a
  recommended mitigation).

## Current Security Posture (v1.0)

All data is transmitted over HTTPS via Supabase TLS. Row Level Security is
configured in `supabase/schema.sql`. Dashboard authentication is not built-in
— deployment behind Vercel password protection or a VPN is strongly recommended.
