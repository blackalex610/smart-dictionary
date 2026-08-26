import { Folder, FolderOpen, Plus } from 'lucide-react'
import { useT } from '@/context/I18nContext'
import { cn } from '@/lib/cn'

interface Props {
  folders: string[]
  counts: Record<string, number>
  total: number
  active: string | null
  onSelect: (folder: string | null) => void
  onCreate: () => void
}

export function FolderSidebar({ folders, counts, total, active, onSelect, onCreate }: Props) {
  const t = useT()

  const rows: { key: string | null; label: string; count: number }[] = [
    { key: null, label: t('all-words'), count: total },
    ...folders.map((folder) => ({ key: folder, label: folder, count: counts[folder] ?? 0 })),
  ]

  return (
    <aside className="flex h-full min-h-[560px] flex-col rounded-card border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between px-5 pb-3 pt-[18px]">
        <h2 className="text-[15px] font-semibold text-fg">{t('my-folders')}</h2>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-lg p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-brand"
          aria-label={t('new-folder')}
        >
          <Plus size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-slim px-2 pb-2">
        <ul className="space-y-0.5">
          {rows.map((row) => {
            const isActive = active === row.key
            const Icon = isActive ? FolderOpen : Folder
            return (
              <li key={row.key ?? '__all__'} className="relative">
                {isActive && (
                  <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-brand" />
                )}
                <button
                  type="button"
                  onClick={() => onSelect(row.key)}
                  className={cn(
                    'flex h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left transition',
                    isActive ? 'bg-brand-soft text-brand' : 'text-fg hover:bg-surface-2',
                  )}
                >
                  <Icon size={17} className={isActive ? 'text-brand' : 'text-fg-subtle'} />
                  <span
                    className={cn(
                      'flex-1 truncate text-[14.5px]',
                      isActive ? 'font-semibold' : 'font-normal',
                    )}
                  >
                    {row.label}
                  </span>
                  <span
                    className={cn(
                      'text-[13px] tabular-nums',
                      isActive ? 'font-semibold text-brand' : 'text-fg-subtle',
                    )}
                  >
                    {row.count}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="p-4 pt-2">
        <button
          type="button"
          onClick={onCreate}
          className="flex h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-surface-2 text-[14px] font-medium text-fg-muted transition hover:bg-brand-soft hover:text-brand"
        >
          <Plus size={16} />
          {t('create-new-folder')}
        </button>
      </div>
    </aside>
  )
}
