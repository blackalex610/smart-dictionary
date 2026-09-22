import { describe, expect, it } from 'vitest'
import { parseChatReply } from './actions'

describe('parseChatReply', () => {
  it('returns the text untouched when there is no directive', () => {
    const { text, actions } = parseChatReply('A noun names a thing.')
    expect(text).toBe('A noun names a thing.')
    expect(actions).toEqual([])
  })

  it('strips the directive from the visible reply', () => {
    const { text, actions } = parseChatReply(
      'Starting your test now.\n\n[[action:start-quiz type=gap count=5 difficulty=hard]]',
    )
    expect(text).toBe('Starting your test now.')
    expect(actions).toEqual([{ kind: 'start-quiz', quizType: 'gap', count: 5, difficulty: 'hard' }])
  })

  it('falls back to sane defaults for missing or invalid arguments', () => {
    const { actions } = parseChatReply('[[action:start-quiz type=nonsense count=abc]]')
    expect(actions).toEqual([
      { kind: 'start-quiz', quizType: 'multiple', count: 10, difficulty: 'medium' },
    ])
  })

  it('clamps the question count to the allowed range', () => {
    const { actions } = parseChatReply('[[action:start-quiz count=999]]')
    expect(actions[0]).toMatchObject({ count: 20 })
  })

  it('accepts quoted values containing spaces', () => {
    const { actions } = parseChatReply(
      '[[action:add-word word="set off" definition="to begin a journey" pos=verb]]',
    )
    expect(actions).toEqual([
      {
        kind: 'add-word',
        word: 'set off',
        definition: 'to begin a journey',
        partOfSpeech: 'verb',
      },
    ])
  })

  it('discards an add-word directive missing a part of speech', () => {
    const { actions } = parseChatReply('[[action:add-word word="x" definition="y"]]')
    expect(actions).toEqual([])
  })

  it('reads a navigation directive', () => {
    const { actions } = parseChatReply('Here you go. [[action:open view=flashcards]]')
    expect(actions).toEqual([{ kind: 'open', view: 'flashcards' }])
  })

  it('discards a navigation directive for an unknown view', () => {
    expect(parseChatReply('[[action:open view=billing]]').actions).toEqual([])
  })

  it('treats flashcards without a count as the whole selection', () => {
    expect(parseChatReply('[[action:start-flashcards]]').actions).toEqual([
      { kind: 'start-flashcards', count: null },
    ])
  })

  it('ignores directives it does not recognise', () => {
    const { text, actions } = parseChatReply('Sure. [[action:delete-everything]]')
    expect(text).toBe('Sure.')
    expect(actions).toEqual([])
  })

  it('collects every directive in the reply', () => {
    const { actions } = parseChatReply(
      '[[action:open view=tests]] and [[action:start-flashcards count=3]]',
    )
    expect(actions).toHaveLength(2)
  })
})
