import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
const OPENROUTER_SITE_URL = Deno.env.get('OPENROUTER_SITE_URL') ?? 'https://umenrechnik.app'
const OPENROUTER_APP_NAME = Deno.env.get('OPENROUTER_APP_NAME') ?? 'Smart Dictionary'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

// Per-function model routing (all served through OpenRouter). `FALLBACK` is
// used as a second attempt whenever a task's primary model call fails.
const MODELS = {
  chat: 'deepseek/deepseek-v4.1-flash',
  quiz: 'z-ai/glm-5.3-flash',
  extraction: 'z-ai/glm-5.3-flash',
  fallback: 'z-ai/glm-5.3',
} as const

async function openRouterRequest(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: { temperature?: number; responseFormatJson?: boolean } = {},
) {
  const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': OPENROUTER_SITE_URL,
      'X-Title': OPENROUTER_APP_NAME,
    },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.5,
      ...(opts.responseFormatJson ? { response_format: { type: 'json_object' } } : {}),
      messages,
    }),
  })

  if (!aiRes.ok) {
    const errText = await aiRes.text()
    throw new Error(errText)
  }

  const aiJson = await aiRes.json()
  return aiJson?.choices?.[0]?.message?.content ?? ''
}

/**
 * Runs the task on its assigned model; if that call fails for any reason
 * (rate limit, provider outage, malformed response), retries once against
 * `MODELS.fallback` before giving up.
 */
async function aiCompletion(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: { temperature?: number; responseFormatJson?: boolean } = {},
) {
  try {
    return await openRouterRequest(model, messages, opts)
  } catch {
    if (model === MODELS.fallback) throw new Error('AI_REQUEST_FAILED')
    return await openRouterRequest(MODELS.fallback, messages, opts)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!OPENROUTER_API_KEY) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized user' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Daily usage gate. Enforced atomically per tier before any AI call.
    const { data: usageRows, error: usageError } = await supabase.rpc('consume_ai_request_quota', {
      p_user_id: userData.user.id,
    })

    if (usageError) {
      return new Response(JSON.stringify({ error: usageError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const usage = usageRows?.[0]
    if (!usage?.allowed) {
      return new Response(
        JSON.stringify({
          error: 'AI_DAILY_LIMIT_REACHED',
          message: 'Daily AI limit reached for your current plan.',
          usage,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ── Input validation ────────────────────────────────────────────
    const KNOWN_TYPES = new Set([
      'chat',
      'generate-wrong-answers',
      'generate-reading-comprehension',
      'generate-open-clause',
      'generate-gap-fill',
      'generate-gap-fill-verb-form',
      'structure-words',
    ])
    const MAX_STR = 2000 // chars per free-text field
    const MAX_WORDS = 200 // max items in words array

    let body: { type?: unknown; payload?: Record<string, unknown> }
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { type, payload } = body

    if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) {
      return new Response(JSON.stringify({ error: 'Invalid or missing type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    function safeStr(v: unknown, max = MAX_STR): string {
      return String(v ?? '')
        .trim()
        .slice(0, max)
    }

    // Difficulty tunes how close the distractors / sentences sit to the target.
    const DIFFICULTY_HINTS: Record<string, string> = {
      easy: 'Aim at a beginner learner: use short, common vocabulary and make the distractors clearly unrelated to the target meaning.',
      medium:
        'Aim at an intermediate learner: use everyday vocabulary and make the distractors plausible but clearly distinguishable.',
      hard: 'Aim at an advanced learner: use richer vocabulary and make the distractors contextually similar to the correct answer but fundamentally different in meaning.',
    }

    function difficultyHint(v: unknown): string {
      const key = String(v ?? '').toLowerCase()
      return DIFFICULTY_HINTS[key] ?? DIFFICULTY_HINTS.medium
    }
    // ───────────────────────────────────────────────────────────────

    if (type === 'chat') {
      const message = safeStr(payload?.message)
      if (!message) {
        return new Response(JSON.stringify({ error: 'message is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const words = (Array.isArray(payload?.words) ? payload.words : []).slice(0, MAX_WORDS)
      const wordSummary = words
        .map(
          (w: { word?: string; definition?: string }) =>
            `- ${safeStr(w.word, 100)}: ${safeStr(w.definition, 300)}`,
        )
        .join('\n')

      const systemPrompt =
        'You are a helpful language-learning assistant. Use dictionary context only when relevant.\n\n' +
        `User dictionary:\n${wordSummary}`

      const text = await aiCompletion(
        MODELS.chat,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        { temperature: 0.5 },
      )

      return new Response(JSON.stringify({ response: text, usage }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (type === 'generate-wrong-answers') {
      const word = safeStr(payload?.word, 100)
      const partOfSpeech = safeStr(payload?.partOfSpeech, 50)
      const prompt = `Generate 1 correct and 3 plausible incorrect definitions for the word "${word}" (${partOfSpeech}). ${difficultyHint(payload?.difficulty)} Return JSON only: {"correctAnswer": string, "wrongAnswers": string[]}.`

      const text = await aiCompletion(
        MODELS.quiz,
        [
          { role: 'system', content: 'You return strict JSON.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.7, responseFormatJson: true },
      )
      const parsed = JSON.parse(text)

      return new Response(JSON.stringify({ ...parsed, usage }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (type === 'generate-reading-comprehension') {
      const words = (Array.isArray(payload?.words) ? payload.words : [])
        .slice(0, MAX_WORDS)
        .map((w: unknown) => safeStr(w, 100))
      const questionCount = Math.min(20, Math.max(1, Number(payload?.questionCount ?? 3)))
      const prompt = `Create one reading passage in English using these words naturally: ${words.join(', ')}. Then create ${questionCount} multiple-choice questions with options A, B, C, D and provide an answer key. ${difficultyHint(payload?.difficulty)} Use this exact structure:\nPassage:\n...\nQuestions:\n1. ...\nA) ...\nB) ...\nC) ...\nD) ...\nAnswers:\n1. A\n2. C`
      const content = await aiCompletion(
        MODELS.quiz,
        [
          {
            role: 'system',
            content: 'You are an English teacher producing reading comprehension material.',
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.4 },
      )
      return new Response(JSON.stringify({ content, usage }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (type === 'generate-open-clause') {
      const word = safeStr(payload?.word, 100)
      const definition = safeStr(payload?.definition)
      const prompt = `Return JSON only with keys question and answer. Build a short open question where the answer must be the word "${word}" and uses definition: "${definition}". ${difficultyHint(payload?.difficulty)}`
      const text = await aiCompletion(
        MODELS.quiz,
        [
          { role: 'system', content: 'You return strict JSON.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.5, responseFormatJson: true },
      )
      return new Response(JSON.stringify({ ...JSON.parse(text), usage }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (type === 'generate-gap-fill') {
      const word = safeStr(payload?.word, 100)
      const definition = safeStr(payload?.definition)
      const prompt = `Return JSON only with keys sentence and answer. Create one sentence with a blank ____ where answer is "${word}". Use definition context: "${definition}". ${difficultyHint(payload?.difficulty)}`
      const text = await aiCompletion(
        MODELS.quiz,
        [
          { role: 'system', content: 'You return strict JSON.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.5, responseFormatJson: true },
      )
      return new Response(JSON.stringify({ ...JSON.parse(text), usage }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (type === 'generate-gap-fill-verb-form') {
      const word = safeStr(payload?.word, 100)
      const definition = safeStr(payload?.definition)
      const prompt = `Return JSON only with keys sentence and answer. Create one sentence with blank ____ that requires a correct verb form derived from "${word}". Use definition context: "${definition}". ${difficultyHint(payload?.difficulty)}`
      const text = await aiCompletion(
        MODELS.quiz,
        [
          { role: 'system', content: 'You return strict JSON.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.5, responseFormatJson: true },
      )
      return new Response(JSON.stringify({ ...JSON.parse(text), usage }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (type === 'structure-words') {
      const rawText = safeStr(payload?.raw_text, 8000)
      const prompt =
        'You will receive unstructured dictionary entries in English or Bulgarian. Return clean CSV-like lines with format word,definition,part of speech. No header. One per line. Part of speech must be one of noun, verb, adjective, adverb. If missing, infer it. If part of speech is Bulgarian, translate it. Keep original language for word/definition.\n\nInput:\n' +
        rawText
      const content = await aiCompletion(
        MODELS.extraction,
        [
          { role: 'system', content: 'You clean dictionary lists.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2 },
      )
      return new Response(JSON.stringify({ content, usage }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `Unsupported type: ${type}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
