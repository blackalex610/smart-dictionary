import {
  isDifficulty,
  isPartOfSpeech,
  isQuizType,
  type Difficulty,
  type PartOfSpeech,
  type QuizType,
} from '@/types/domain'

/**
 * The paper's "the assistant ... can perform actions within the application
 * (for example, run tests)". The model is told to append a directive such as
 * `[[action:start-quiz type=multiple count=10]]` to its reply; we strip it from
 * the visible text and run it.
 */
export type ChatAction =
  | { kind: 'start-quiz'; quizType: QuizType; count: number; difficulty: Difficulty }
  | { kind: 'start-flashcards'; count: number | null }
  | { kind: 'open'; view: AppView }
  | { kind: 'add-word'; word: string; definition: string; partOfSpeech: PartOfSpeech }

export const APP_VIEWS = ['dictionary', 'flashcards', 'tests', 'settings'] as const
export type AppView = (typeof APP_VIEWS)[number]

export const VIEW_ROUTES: Record<AppView, string> = {
  dictionary: '/app',
  flashcards: '/app/flashcards',
  tests: '/app/tests',
  settings: '/app/settings',
}

const DIRECTIVE = /\[\[\s*action\s*:\s*([a-z-]+)([^\]]*)\]\]/gi
const ARG = /([a-z][a-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))/gi

function parseArgs(raw: string): Record<string, string> {
  const args: Record<string, string> = {}
  ARG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ARG.exec(raw)) !== null) {
    args[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '').trim()
  }
  return args
}

function clampCount(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(20, value))
}

function toAction(name: string, args: Record<string, string>): ChatAction | null {
  switch (name.toLowerCase()) {
    case 'start-quiz':
    case 'start-test': {
      const quizType = args.type?.toLowerCase()
      const difficulty = args.difficulty?.toLowerCase()
      return {
        kind: 'start-quiz',
        quizType: isQuizType(quizType) ? quizType : 'multiple',
        count: clampCount(args.count, 10),
        difficulty: isDifficulty(difficulty) ? difficulty : 'medium',
      }
    }

    case 'start-flashcards':
    case 'start-practice':
      return {
        kind: 'start-flashcards',
        count: args.count ? clampCount(args.count, 10) : null,
      }

    case 'open':
    case 'navigate': {
      const view = (args.view ?? args.to ?? '').toLowerCase()
      return (APP_VIEWS as readonly string[]).includes(view)
        ? { kind: 'open', view: view as AppView }
        : null
    }

    case 'add-word': {
      const word = args.word?.trim()
      const definition = (args.definition ?? args.meaning ?? '').trim()
      const partOfSpeech = (args.pos ?? args.partofspeech ?? '').toLowerCase()
      if (!word || !definition || !isPartOfSpeech(partOfSpeech)) return null
      return { kind: 'add-word', word, definition, partOfSpeech }
    }

    default:
      return null
  }
}

export interface ParsedReply {
  /** The reply with every directive removed, ready to render. */
  text: string
  actions: ChatAction[]
}

export function parseChatReply(reply: string): ParsedReply {
  const actions: ChatAction[] = []

  DIRECTIVE.lastIndex = 0
  const text = reply.replace(DIRECTIVE, (_match, name: string, rest: string) => {
    const action = toAction(name, parseArgs(rest))
    if (action) actions.push(action)
    return ''
  })

  return {
    text: text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    actions,
  }
}
