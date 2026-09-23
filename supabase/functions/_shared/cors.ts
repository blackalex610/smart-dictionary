export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * `ALLOWED_ORIGINS` is a comma-separated list such as
 * `https://umenrechnik.app,http://localhost:5173`. Unset means any origin, which
 * is fine for local development: every request still needs a valid user JWT.
 */
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

export function corsHeadersFor(req: Request): Record<string, string> {
  if (allowedOrigins.length === 0) return corsHeaders
  const origin = req.headers.get('Origin') ?? ''
  return {
    ...corsHeaders,
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    Vary: 'Origin',
  }
}
