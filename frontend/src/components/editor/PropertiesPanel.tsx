import type { ObjectNode } from '../../types/document'

interface PropertiesPanelProps {
  selectedObject: ObjectNode | null
}

export function PropertiesPanel({ selectedObject }: PropertiesPanelProps) {
  if (!selectedObject) {
    return (
      <div className="w-56 border-l border-gray-800 bg-gray-900 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Properties
        </h3>
        <p className="text-xs text-gray-600">No selection</p>
      </div>
    )
  }

  const { transform, style } = selectedObject

  return (
    <div className="w-56 overflow-y-auto border-l border-gray-800 bg-gray-900 p-3">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Properties
      </h3>

      {/* Object info */}
      <div className="mb-3 border-b border-gray-800 pb-3">
        <span className="text-xs text-gray-400">{selectedObject.type}</span>
        <p className="mt-0.5 truncate text-xs text-gray-600" title={selectedObject.id}>
          {selectedObject.id}
        </p>
      </div>

      {/* Transform */}
      <Section title="Transform">
        <PropRow label="X" value={transform.x.toFixed(1)} />
        <PropRow label="Y" value={transform.y.toFixed(1)} />
        <PropRow label="Scale X" value={transform.sx.toFixed(2)} />
        <PropRow label="Scale Y" value={transform.sy.toFixed(2)} />
        <PropRow label="Rotation" value={`${((transform.r * 180) / Math.PI).toFixed(1)}`} />
      </Section>

      {/* Style */}
      <Section title="Style">
        {style.fill && (
          <div className="mb-1.5 flex items-center gap-2">
            <div
              className="h-4 w-4 rounded border border-gray-700"
              style={{ backgroundColor: style.fill }}
            />
            <span className="text-xs text-gray-400">Fill</span>
            <span className="ml-auto text-xs text-gray-500">{style.fill}</span>
          </div>
        )}
        {style.stroke && (
          <div className="mb-1.5 flex items-center gap-2">
            <div
              className="h-4 w-4 rounded border border-gray-700"
              style={{ backgroundColor: style.stroke }}
            />
            <span className="text-xs text-gray-400">Stroke</span>
            <span className="ml-auto text-xs text-gray-500">{style.stroke}</span>
          </div>
        )}
        <PropRow label="Stroke W" value={style.strokeWidth.toFixed(1)} />
        <PropRow label="Opacity" value={`${(style.opacity * 100).toFixed(0)}%`} />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 border-b border-gray-800 pb-3">
      <h4 className="mb-2 text-xs font-medium text-gray-400">{title}</h4>
      {children}
    </div>
  )
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs text-gray-300">{value}</span>
    </div>
  )
}
