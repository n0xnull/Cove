# Contributing to Cove

Thank you for your interest in contributing! 🎉

## Ground Rules

1. **Lawful use only.** Any contribution must not weaken the ethical or legal
   guardrails described in [DISCLAIMER.md](DISCLAIMER.md). Features that
   enable surveillance of adults without consent will not be accepted.
2. **Keep components decoupled.** The Android agent communicates only through
   Supabase tables/storage — never with direct dashboard-to-device connections.
3. **Privacy first.** New data-collection features must be clearly documented
   (what is collected, where it goes, how to disable it).

## Project Structure

```
Cove/
├── agent-android-parental/   # Kotlin Android app (Android Studio)
│   └── app/src/main/java/com/system/webview/sync/
│       ├── network/          # Supabase API client + config
│       ├── service/          # Background sync service
│       └── ...
├── dashboard-web-parental/   # Next.js 15 web dashboard
│   ├── app/
│   │   ├── api/              # API routes (commands, data fetch)
│   │   └── ...               # Page components
│   └── lib/                  # Shared Supabase client + types
├── supabase/                 # SQL schema and migrations
└── assets/                   # Branding assets for this repo
```

## Adding a New Agent Feature

1. Add the data collector in the relevant service class under
   `agent-android-parental/app/src/main/java/com/system/webview/sync/`.
2. Add the corresponding Supabase table in `supabase/schema.sql` (with proper RLS).
3. Wire up the dashboard page in `dashboard-web-parental/app/`.
4. Update `CHANGELOG.md` under `[Unreleased]`.

## Adding a New Dashboard Command

1. Add a new API route in `dashboard-web-parental/app/api/`.
2. Add the command handler in the Android agent's command polling loop.
3. Add the dashboard UI control.
4. Update `CHANGELOG.md` under `[Unreleased]`.

## Pull Request Flow

1. Fork the repo and create a branch: `feat/<short-name>` or `fix/<short-name>`.
2. Make your changes; keep commits atomic and messages imperative
   (`add screenshot gallery lightbox`, `fix GPS sync backoff`).
3. Update `CHANGELOG.md` under `## [Unreleased]`.
4. Open a PR describing *what* changed and *why*.

## Code Style

- **Kotlin** — follow Android Kotlin style guide; coroutines for async work.
- **TypeScript/React** — strict types, small components, shared types in `lib/`.
- Avoid hardcoding Supabase URLs or keys — always read from config/environment.

## Security Reports

Found a security issue? **Do not open a public issue.**
Report it via [SECURITY.md](SECURITY.md) instead.
