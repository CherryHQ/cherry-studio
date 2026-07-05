// WIP dev consumer for the v2 export pipeline.
//
// NOT the final V2 settings UI — the real V2 surface (save dialog + i18n + progress
// UI) replaces legacy v1 backup in a follow-up UX slice. This component exists so
// the BackupV2_StartBackup IPC channel + useBackupV2 hook have a real consumer
// (demand-first) and so the pipeline can be exercised end-to-end from the app.
// Labels are hardcoded throwaway dev UX, intentionally NOT i18n'd.
import { useState } from 'react'

import { useBackupV2 } from '@renderer/hooks/useBackupV2'

type Preset = 'full' | 'lite'

export const BackupV2DevExport: React.FC = () => {
  const { startBackup, cancelBackup, loading, progress, cancelled } = useBackupV2()
  const [preset, setPreset] = useState<Preset>('full')
  const [outputPath, setOutputPath] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const onExport = async () => {
    if (!outputPath) {
      setStatus('enter an absolute output path (.cbu)')
      return
    }
    setStatus(null)
    try {
      const result = await startBackup(preset, outputPath)
      setStatus(`ok → ${result.archivePath}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={{ borderTop: '1px dashed var(--border-color)', marginTop: 16, paddingTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>V2 export (dev · WIP)</div>
      {/* Preset picker — full (all 14 domains + blobs) vs lite (10 domains, no blobs). */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12 }}>
        {(['full', 'lite'] as const).map((p) => (
          <label key={p} style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              checked={preset === p}
              onChange={() => setPreset(p)}
              data-testid={`v2-export-preset-${p}`}
            />
            {p}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={outputPath}
          onChange={(e) => setOutputPath(e.target.value)}
          placeholder="/absolute/path/to/backup.cbu"
          style={{ flex: 1, padding: '4px 8px' }}
          data-testid="v2-export-path"
        />
        <button onClick={onExport} disabled={loading || !outputPath} data-testid="v2-export-run">
          {loading ? '...' : 'Export V2'}
        </button>
        {loading && (
          <button onClick={() => cancelBackup()} data-testid="v2-export-cancel">
            Cancel
          </button>
        )}
      </div>
      {progress && (
        <div style={{ fontSize: 12, marginTop: 4 }} data-testid="v2-export-progress">
          {progress.phase} {progress.current}/{progress.total}
          {progress.message ? ` — ${progress.message}` : ''}
        </div>
      )}
      {cancelled && (
        <div style={{ fontSize: 12, marginTop: 4 }} data-testid="v2-export-cancelled">
          cancelled
        </div>
      )}
      {status && <div style={{ fontSize: 12, marginTop: 4 }}>{status}</div>}
    </div>
  )
}
