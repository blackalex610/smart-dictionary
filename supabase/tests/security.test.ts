// @vitest-environment node
/**
 * Applies every migration to a real Postgres (PGlite, WASM) with a stubbed
 * Supabase `auth` schema and roles, then checks the security properties the
 * app relies on: row-level isolation, quota integrity, tier protection and
 * size limits. A regression here is a data-leak or cost-abuse bug.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))
const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const P = '33333333-3333-3333-3333-333333333333'

let db: PGlite

/** Runs `sql` as a PostgREST request from `uid` would: role + JWT claims set. */
async function as<T = Record<string, unknown>>(
  uid: string | null,
  sql: string,
  role = 'authenticated',
): Promise<T[]> {
  const claims = uid === null ? '' : JSON.stringify({ sub: uid, role })
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false);`)
  if (uid !== null) await db.exec(`set role ${role}`)
  try {
    return (await db.query<T>(sql)).rows
  } finally {
    await db.exec('reset role')
  }
}
const admin = <T = Record<string, unknown>>(sql: string) => as<T>(null, sql)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    -- Supabase grants these by default; the migrations must revoke what matters.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    // pgcrypto is not bundled with PGlite; gen_random_uuid() is core since PG13.
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(
      /create extension if not exists pgcrypto;/i,
      '',
    )
    await db.exec(sql)
  }
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${P}')`)
  await admin(`update public.profiles set tier = 'premium' where user_id = '${P}'`)
}, 60_000)

describe('migrations', () => {
  it('re-applying the hardening migration is safe', async () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.includes('security_hardening'))!
    await expect(db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))).resolves.toBeDefined()
  })
})

describe('AI quota', () => {
  it('cannot be reset or written by the client', async () => {
    await as(A, 'select * from public.consume_ai_request_quota()')
    await as(A, 'update public.usage_daily set ai_requests = 0')
    const [row] = await admin<{ ai_requests: number }>(
      `select ai_requests from public.usage_daily where user_id = '${A}'`,
    )
    expect(row.ai_requests).toBe(1)
    await expect(
      as(
        A,
        `insert into public.usage_daily (user_id, usage_date) values ('${A}', current_date + 1)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('is bound to the caller', async () => {
    await expect(as(A, `select * from public.consume_ai_request_quota('${B}')`)).rejects.toThrow(
      /another user/,
    )
    await expect(as(A, `select * from public.get_today_ai_usage('${B}')`)).rejects.toThrow(
      /another user/,
    )
    await expect(as(A, 'select * from public.consume_ai_request_quota()', 'anon')).rejects.toThrow(
      /permission denied/,
    )
    await expect(as(A, `select public.get_user_tier('${B}')`)).rejects.toThrow(/permission denied/)
    await expect(as(A, `select * from public.increment_ai_usage('${B}', 999)`)).rejects.toThrow(
      /does not exist/,
    )
  })

  it('stops a free user after 10 requests a day', async () => {
    let last: Record<string, unknown> = {}
    for (let i = 0; i < 10; i++) {
      ;[last] = await as(A, 'select * from public.consume_ai_request_quota()')
    }
    expect(last).toMatchObject({ allowed: false, used: 10, reason: 'daily_limit' })
    const [usage] = await as(A, 'select * from public.get_today_ai_usage()')
    expect(usage).toMatchObject({ used: 10, limit_value: 10, is_unlimited: false })
  })

  it('burst-limits premium at 40 requests a minute', async () => {
    let last: Record<string, unknown> = {}
    for (let i = 0; i < 41; i++) {
      ;[last] = await as(P, 'select * from public.consume_ai_request_quota()')
    }
    expect(last).toMatchObject({ allowed: false, reason: 'rate_limited', is_unlimited: true })
  })
})

describe('profiles', () => {
  it('a user cannot upgrade their own tier', async () => {
    await expect(
      as(A, `update public.profiles set tier = 'premium' where user_id = '${A}'`),
    ).rejects.toThrow(/service role/)
    await as(A, `update public.profiles set display_name = 'Al' where user_id = '${A}'`)
    const [row] = await admin(`select display_name from public.profiles where user_id = '${A}'`)
    expect(row.display_name).toBe('Al')
  })

  it('a self-inserted profile is forced to the free tier', async () => {
    await admin(`delete from public.profiles where user_id = '${B}'`)
    await as(B, `insert into public.profiles (user_id, tier) values ('${B}', 'premium')`)
    const [row] = await admin(`select tier from public.profiles where user_id = '${B}'`)
    expect(row.tier).toBe('free')
  })

  it('the service role can change a tier', async () => {
    await as(
      A,
      `update public.profiles set tier = 'premium' where user_id = '${A}'`,
      'service_role',
    )
    const [row] = await admin(`select tier from public.profiles where user_id = '${A}'`)
    expect(row.tier).toBe('premium')
    await admin(`update public.profiles set tier = 'free' where user_id = '${A}'`)
  })
})

describe('words', () => {
  it('are isolated per user', async () => {
    await as(
      A,
      `insert into public.words (user_id, word, definition, part_of_speech) values ('${A}', 'apple', 'fruit', 'noun')`,
    )
    await expect(
      as(
        A,
        `insert into public.words (user_id, word, definition, part_of_speech) values ('${B}', 'x', 'y', 'noun')`,
      ),
    ).rejects.toThrow(/row-level security/)
    expect(await as(B, 'select * from public.words')).toHaveLength(0)
    await as(B, 'delete from public.words')
    await as(B, `update public.words set definition = 'hacked'`)
    const rows = await admin<{ definition: string }>('select definition from public.words')
    expect(rows).toEqual([{ definition: 'fruit' }])
  })

  it('reject duplicates and over-long text', async () => {
    await expect(
      as(
        A,
        `insert into public.words (user_id, word, definition, part_of_speech) values ('${A}', 'APPLE', 'again', 'noun')`,
      ),
    ).rejects.toThrow(/duplicate key/)
    await expect(
      as(
        A,
        `insert into public.words (user_id, word, definition, part_of_speech) values ('${A}', 'long', repeat('x', 2001), 'noun')`,
      ),
    ).rejects.toThrow(/words_definition_length/)
  })

  it('cap the free plan at 300', async () => {
    await admin(`insert into public.words (user_id, word, definition, part_of_speech)
      select '${A}', 'w' || g, 'd', 'noun' from generate_series(1, 299) g`)
    await expect(
      as(
        A,
        `insert into public.words (user_id, word, definition, part_of_speech) values ('${A}', 'extra', 'd', 'noun')`,
      ),
    ).rejects.toThrow(/FREE_WORD_LIMIT_REACHED/)
  })
})

describe('progress', () => {
  it('rejects impossible scores', async () => {
    await expect(
      as(
        A,
        `insert into public.progress (user_id, quiz_type, score, total_questions) values ('${A}', 'multiple', 11, 10)`,
      ),
    ).rejects.toThrow(/progress_score_le_total/)
  })
})
