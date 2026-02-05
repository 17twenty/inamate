import { useEditorStore } from '../../stores/editorStore'

export function PresenceAvatars() {
  const presences = useEditorStore((s) => s.presences)
  const connected = useEditorStore((s) => s.connected)

  const entries = Array.from(presences.values())

  return (
    <div className="flex items-center gap-2">
      <div className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
      {entries.map((entry) => (
        <div
          key={entry.userId}
          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: entry.color }}
          title={entry.displayName}
        >
          {entry.displayName.charAt(0).toUpperCase()}
        </div>
      ))}
    </div>
  )
}
