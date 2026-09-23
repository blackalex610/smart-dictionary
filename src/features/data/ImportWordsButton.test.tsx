import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { I18nProvider } from '@/context/I18nContext'
import { GUEST_WORDS_KEY } from '@/lib/guest/guestStore'

// Guest mode: words live in localStorage and no network is involved.
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ state: { status: 'guest' }, scope: 'guest' }),
}))
vi.mock('@/lib/supabase/ai', () => ({ aiStructureWords: vi.fn() }))
vi.mock('@/lib/supabase/words', () => ({ supabaseWords: {} }))

const { ImportWordsButton } = await import('./ImportWordsButton')

function renderButton() {
  localStorage.setItem('appSettings', JSON.stringify({ language: 'en' }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>
          <ImportWordsButton folder="Imported" />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

async function confirmOptions(user: ReturnType<typeof userEvent.setup>) {
  const options = await screen.findByRole('dialog', { name: 'Import options' })
  await user.click(within(options).getByRole('button', { name: 'Import from File' }))
}

function storedWords(): { word: string; folder: string }[] {
  return JSON.parse(localStorage.getItem(GUEST_WORDS_KEY) ?? '[]')
}

describe('ImportWordsButton (guest)', () => {
  it('previews, skips duplicates and saves only after confirmation', async () => {
    localStorage.setItem(
      GUEST_WORDS_KEY,
      JSON.stringify([{ id: 'x', word: 'apple', definition: 'fruit', partOfSpeech: 'noun' }]),
    )
    const user = userEvent.setup()
    const { container } = renderButton()

    const file = new File(
      [
        'apple,a fruit,noun\nrun,to move fast,verb\nrun,to move fast,verb\nbright,full of light,adjective',
      ],
      'words.txt',
      { type: 'text/plain' },
    )
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file)

    // Options dialog → import. Splitting by line keeps one entry per line.
    const options = await screen.findByRole('dialog', { name: 'Import options' })
    await user.click(within(options).getByLabelText('Split by paragraph'))
    await user.click(within(options).getByRole('button', { name: 'Import from File' }))

    const dialog = await screen.findByRole('dialog', { name: 'Review import' })
    expect(dialog).toHaveTextContent('2 new word(s) will be added to “Imported”.')
    expect(dialog).toHaveTextContent('1 already in your dictionary — skipped.')
    expect(dialog).toHaveTextContent('1 repeated in the file — skipped.')
    // Nothing is written before the user confirms.
    expect(storedWords()).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Add 2 word(s)' }))
    await waitFor(() => expect(storedWords()).toHaveLength(3))
    expect(
      storedWords()
        .filter((w) => w.folder === 'Imported')
        .map((w) => w.word)
        .sort(),
    ).toEqual(['bright', 'run'])
  })

  it('rejects a binary file disguised as text, by its content', async () => {
    const user = userEvent.setup()
    const { container } = renderButton()
    // A PDF renamed to .txt: the extension passes `accept`, the magic bytes do not.
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'scan.txt')
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, pdf)
    await confirmOptions(user)

    expect(
      await screen.findByText('That file format cannot be read in this browser.'),
    ).toBeVisible()
    expect(localStorage.getItem(GUEST_WORDS_KEY)).toBeNull()
  })

  it('tells a guest that unstructured files need an account', async () => {
    const user = userEvent.setup()
    const { container } = renderButton()
    const notes = new File(['Some prose about my holiday, nothing structured here.'], 'notes.txt')
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, notes)
    await confirmOptions(user)

    expect(await screen.findByText('Sign in to import unstructured files.')).toBeVisible()
  })
})
