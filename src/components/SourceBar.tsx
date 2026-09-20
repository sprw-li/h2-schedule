import { setSyncSource, type SyncSource } from '../lib/origin'

type SourceBarProps = {
  value: SyncSource
  onChange: (next: SyncSource) => void
}

export function SourceBar({ value, onChange }: SourceBarProps) {
  return (
    <div className="source-pair" role="group" aria-label="日程入口">
      <button
        type="button"
        className={`source-chip${value === 'clab' ? ' source-on' : ''}`}
        aria-pressed={value === 'clab'}
        onClick={() => {
          if (value === 'clab') return
          setSyncSource('clab')
          onChange('clab')
        }}
      >
        CLab
      </button>
      <button
        type="button"
        className={`source-chip${value === 'github' ? ' source-on' : ''}`}
        aria-pressed={value === 'github'}
        onClick={() => {
          if (value === 'github') return
          setSyncSource('github')
          onChange('github')
        }}
      >
        GitHub
      </button>
    </div>
  )
}
