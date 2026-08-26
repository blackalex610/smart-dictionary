import type { GradedAnswer, QuizGrade, QuizQuestion } from './types'

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isCorrect(question: QuizQuestion, given: string): boolean {
  if (question.kind === 'choice') return given !== '' && Number(given) === question.correctIndex
  return normalise(given) === normalise(question.correctAnswer)
}

export function expectedAnswer(question: QuizQuestion): string {
  return question.kind === 'choice'
    ? (question.options[question.correctIndex] ?? '')
    : question.correctAnswer
}

/** Pure grading — `answers` maps question id to the raw input value. */
export function gradeQuiz(questions: QuizQuestion[], answers: Record<string, string>): QuizGrade {
  const graded: GradedAnswer[] = questions.map((question) => {
    const given = answers[question.id] ?? ''
    return {
      questionId: question.id,
      correct: isCorrect(question, given),
      given,
      expected: expectedAnswer(question),
    }
  })

  const score = graded.filter((answer) => answer.correct).length
  const total = questions.length || 1
  return {
    score,
    total: questions.length,
    percentage: Math.round((score * 100) / total),
    answers: graded,
  }
}

export type Verdict = 'excellent' | 'good' | 'keep-going'

export function verdictFor(percentage: number): Verdict {
  if (percentage >= 80) return 'excellent'
  if (percentage >= 60) return 'good'
  return 'keep-going'
}
