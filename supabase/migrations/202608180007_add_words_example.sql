-- Additive: optional example sentence shown in the word card / add-word form.
-- The React client degrades gracefully if this migration has not been applied,
-- so it can be rolled out independently of a deploy.
alter table public.words
  add column if not exists example text;

comment on column public.words.example is 'Optional example sentence for the word.';
