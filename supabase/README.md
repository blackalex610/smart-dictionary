# Supabase Integration Guide

This folder contains a production-ready backend migration for this app.

## 1) Create project and auth provider

1. Create a Supabase project.
2. In Auth -> Providers, enable Google provider.
3. Set redirect URLs:
   - http://localhost:3000
   - http://localhost:3000/index.html
   - http://localhost:3000/app.html

## 2) Apply DB schema and RLS

1. Run `supabase/schema.sql` in SQL editor.
2. Run `supabase/rls.sql` in SQL editor.

## 3) Frontend setup

1. Copy `supabase/frontend/supabase.config.example.js` to `supabase/frontend/supabase.config.js`.
2. Fill Supabase URL and anon key.
3. Add these scripts to both `index.html` and `app.html`:

```html
<script type="module" src="supabase/frontend/bootstrap.js"></script>
```

## 4) Edge Functions

1. Install Supabase CLI.
2. Deploy function:

```bash
supabase functions deploy ai-chat
```

3. Set secrets:

```bash
supabase secrets set OPENAI_API_KEY=YOUR_KEY
supabase secrets set OPENAI_MODEL=gpt-4o-mini
```

## 5) Migrate existing `script.js`

Current file still has legacy local/session storage logic.
Use the module functions below as replacements in your handlers:

- Auth: `signInWithGoogle`, `getCurrentUser`, `signOutUser`
- Words: `fetchWords`, `addWord`, `deleteWord`, `updateWord`
- Progress: `saveQuizResultRemote`, `fetchQuizHistory`
- AI: `invokeAiChat`

A complete code sample is in `supabase/frontend/migration-examples.js`.

## 6) Daily usage limits

`increment_ai_usage` is enforced in Edge Function before any OpenAI call.
If limit is reached, function returns HTTP 429.
