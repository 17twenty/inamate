import { useCallback } from "react";
import type {
  ObjectNode,
  Scene,
  Transform,
  Style,
  ShapeRectData,
  ShapeEllipseData,
  RasterImageData,
  TextData,
  SymbolData,
} from "../../types/document";

type AlignType = "left" | "right" | "top" | "bottom" | "centerH" | "centerV";

interface PropertiesPanelProps {
  selectedObject: ObjectNode | null;
  selectedCount?: number;
  scene: Scene | null;
  onSceneUpdate?: (changes: Partial<Scene>) => void;
  onObjectUpdate?: (
    objectId: string,
    changes: { transform?: Partial<Transform>; style?: Partial<Style> },
  ) => void;
  onDataUpdate?: (objectId: string, data: Record<string, unknown>) => void;
  onAlign?: (type: AlignType) => void;
  onDistribute?: (axis: "horizontal" | "vertical") => void;
}

export function PropertiesPanel({
  selectedObject,
  selectedCount = 0,
  scene,
  onSceneUpdate,
  onObjectUpdate,
  onDataUpdate,
  onAlign,
  onDistribute,
}: PropertiesPanelProps) {
  // Show multi-select summary with alignment tools
  if (!selectedObject && selectedCount > 1) {
    return (
      <div className="w-56 border-l border-gray-800 bg-gray-900 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Properties
        </h3>
        <p className="mb-3 text-xs text-gray-400">
          {selectedCount} objects selected
        </p>

        <Section title="Align">
          <div className="grid grid-cols-3 gap-1">
            <AlignButton
              label="Align Left"
              onClick={() => onAlign?.("left")}
              icon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <line x1="2" y1="1" x2="2" y2="15" />
                  <rect x="4" y="3" width="8" height="4" rx="0.5" />
                  <rect x="4" y="9" width="5" height="4" rx="0.5" />
                </svg>
              }
            />
            <AlignButton
              label="Align Center H"
              onClick={() => onAlign?.("centerH")}
              icon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <line x1="8" y1="1" x2="8" y2="15" strokeDasharray="2 1" />
                  <rect x="3" y="3" width="10" height="4" rx="0.5" />
                  <rect x="4.5" y="9" width="7" height="4" rx="0.5" />
                </svg>
              }
            />
            <AlignButton
              label="Align Right"
              onClick={() => onAlign?.("right")}
              icon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <line x1="14" y1="1" x2="14" y2="15" />
                  <rect x="4" y="3" width="8" height="4" rx="0.5" />
                  <rect x="7" y="9" width="5" height="4" rx="0.5" />
                </svg>
              }
            />
            <AlignButton
              label="Align Top"
              onClick={() => onAlign?.("top")}
              icon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <line x1="1" y1="2" x2="15" y2="2" />
                  <rect x="3" y="4" width="4" height="8" rx="0.5" />
                  <rect x="9" y="4" width="4" height="5" rx="0.5" />
                </svg>
              }
            />
            <AlignButton
              label="Align Center V"
              onClick={() => onAlign?.("centerV")}
              icon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <line x1="1" y1="8" x2="15" y2="8" strokeDasharray="2 1" />
                  <rect x="3" y="3" width="4" height="10" rx="0.5" />
                  <rect x="9" y="4.5" width="4" height="7" rx="0.5" />
                </svg>
              }
            />
            <AlignButton
              label="Align Bottom"
              onClick={() => onAlign?.("bottom")}
              icon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <line x1="1" y1="14" x2="15" y2="14" />
                  <rect x="3" y="4" width="4" height="8" rx="0.5" />
                  <rect x="9" y="7" width="4" height="5" rx="0.5" />
                </svg>
              }
            />
          </div>
        </Section>

        <Section title="Distribute">
          <div className="grid grid-cols-2 gap-1">
            <AlignButton
              label="Distribute Horizontally"
              onClick={() => onDistribute?.("horizontal")}
              disabled={selectedCount < 3}
              icon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <line x1="2" y1="1" x2="2" y2="15" />
                  <line x1="8" y1="1" x2="8" y2="15" strokeDasharray="2 1" />
                  <line x1="14" y1="1" x2="14" y2="15" />
                  <rect x="1" y="5" width="3" height="6" rx="0.5" />
                  <rect x="6.5" y="5" width="3" height="6" rx="0.5" />
                  <rect x="12" y="5" width="3" height="6" rx="0.5" />
                </svg>
              }
            />
            <AlignButton
              label="Distribute Vertically"
              onClick={() => onDistribute?.("vertical")}
              disabled={selectedCount < 3}
              icon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <line x1="1" y1="2" x2="15" y2="2" />
                  <line x1="1" y1="8" x2="15" y2="8" strokeDasharray="2 1" />
                  <line x1="1" y1="14" x2="15" y2="14" />
                  <rect x="5" y="1" width="6" height="3" rx="0.5" />
                  <rect x="5" y="6.5" width="6" height="3" rx="0.5" />
                  <rect x="5" y="12" width="6" height="3" rx="0.5" />
                </svg>
              }
            />
          </div>
        </Section>
      </div>
    );
  }

  // Show scene properties when nothing is selected
  if (!selectedObject) {
    if (!scene) {
      return (
        <div className="w-56 border-l border-gray-800 bg-gray-900 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Properties
          </h3>
          <p className="text-xs text-gray-600">No scene loaded</p>
        </div>
      );
    }

    return <SceneProperties scene={scene} onSceneUpdate={onSceneUpdate} />;
  }

  return (
    <ObjectProperties
      object={selectedObject}
      onObjectUpdate={onObjectUpdate}
      onDataUpdate={onDataUpdate}
    />
  );
}

// --- Scene Properties ---

interface ScenePropertiesProps {
  scene: Scene;
  onSceneUpdate?: (changes: Partial<Scene>) => void;
}

function SceneProperties({ scene, onSceneUpdate }: ScenePropertiesProps) {
  const handleChange = useCallback(
    (field: keyof Scene, value: string | number) => {
      onSceneUpdate?.({ [field]: value });
    },
    [onSceneUpdate],
  );

  return (
    <div className="w-56 overflow-y-auto border-l border-gray-800 bg-gray-900 p-3">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Artboard
      </h3>

      <Section title="Scene">
        <EditablePropRow
          label="Name"
          value={scene.name}
          onChange={(v) => handleChange("name", v)}
          type="text"
        />
      </Section>

      <Section title="Dimensions">
        <EditablePropRow
          label="Width"
          value={scene.width}
          onChange={(v) => handleChange("width", parseInt(v) || 0)}
          type="number"
        />
        <EditablePropRow
          label="Height"
          value={scene.height}
          onChange={(v) => handleChange("height", parseInt(v) || 0)}
          type="number"
        />
      </Section>

      <Section title="Background">
        <ColorPropRow
          label="Color"
          value={scene.background}
          onChange={(v) => handleChange("background", v)}
        />
      </Section>
    </div>
  );
}

// --- Object Properties ---

interface ObjectPropertiesProps {
  object: ObjectNode;
  onObjectUpdate?: (
    objectId: string,
    changes: { transform?: Partial<Transform>; style?: Partial<Style> },
  ) => void;
  onDataUpdate?: (objectId: string, data: Record<string, unknown>) => void;
}

function ObjectProperties({
  object,
  onObjectUpdate,
  onDataUpdate,
}: ObjectPropertiesProps) {
  const { transform, style } = object;
  const isLocked = object.locked;

  const handleTransformChange = useCallback(
    (field: keyof Transform, value: number) => {
      onObjectUpdate?.(object.id, { transform: { [field]: value } });
    },
    [object.id, onObjectUpdate],
  );

  const handleStyleChange = useCallback(
    (field: keyof Style, value: string | number) => {
      onObjectUpdate?.(object.id, { style: { [field]: value } });
    },
    [object.id, onObjectUpdate],
  );

  return (
    <div className="w-56 overflow-y-auto border-l border-gray-800 bg-gray-900 p-3">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Properties
      </h3>

      {/* Locked indicator */}
      {isLocked && (
        <div className="mb-3 rounded bg-yellow-900/30 border border-yellow-700/50 px-2 py-1.5 text-xs text-yellow-400">
          Locked
        </div>
      )}

      {/* Object info */}
      <div className="mb-3 border-b border-gray-800 pb-3">
        <span className="text-xs text-gray-400">{object.type}</span>
        <p className="mt-0.5 truncate text-xs text-gray-600" title={object.id}>
          {object.id}
        </p>
      </div>

      {/* Transform */}
      <Section title="Transform">
        <EditablePropRow
          label="X"
          value={transform.x.toFixed(1)}
          onChange={(v) => handleTransformChange("x", parseFloat(v) || 0)}
          type="number"
          disabled={isLocked}
        />
        <EditablePropRow
          label="Y"
          value={transform.y.toFixed(1)}
          onChange={(v) => handleTransformChange("y", parseFloat(v) || 0)}
          type="number"
          disabled={isLocked}
        />
        <EditablePropRow
          label="Scale X"
          value={transform.sx.toFixed(2)}
          onChange={(v) => handleTransformChange("sx", parseFloat(v) || 1)}
          type="number"
          disabled={isLocked}
        />
        <EditablePropRow
          label="Scale Y"
          value={transform.sy.toFixed(2)}
          onChange={(v) => handleTransformChange("sy", parseFloat(v) || 1)}
          type="number"
          disabled={isLocked}
        />
        <EditablePropRow
          label="Rotation"
          value={((transform.r * 180) / Math.PI).toFixed(1)}
          onChange={(v) =>
            handleTransformChange("r", ((parseFloat(v) || 0) * Math.PI) / 180)
          }
          type="number"
          disabled={isLocked}
        />
        <EditablePropRow
          label="Skew X"
          value={(transform.skewX ?? 0).toFixed(1)}
          onChange={(v) => handleTransformChange("skewX", parseFloat(v) || 0)}
          type="number"
          disabled={isLocked}
        />
        <EditablePropRow
          label="Skew Y"
          value={(transform.skewY ?? 0).toFixed(1)}
          onChange={(v) => handleTransformChange("skewY", parseFloat(v) || 0)}
          type="number"
          disabled={isLocked}
        />
        <EditablePropRow
          label="Anchor X"
          value={transform.ax.toFixed(1)}
          onChange={(v) => handleTransformChange("ax", parseFloat(v) || 0)}
          type="number"
          disabled={isLocked}
        />
        <EditablePropRow
          label="Anchor Y"
          value={transform.ay.toFixed(1)}
          onChange={(v) => handleTransformChange("ay", parseFloat(v) || 0)}
          type="number"
          disabled={isLocked}
        />
      </Section>

      {/* Dimensions (type-specific) */}
      {object.type === "ShapeRect" && (
        <Section title="Dimensions">
          <EditablePropRow
            label="Width"
            value={(object.data as ShapeRectData).width.toFixed(1)}
            onChange={(v) =>
              onDataUpdate?.(object.id, { width: parseFloat(v) || 0 })
            }
            type="number"
            disabled={isLocked}
          />
          <EditablePropRow
            label="Height"
            value={(object.data as ShapeRectData).height.toFixed(1)}
            onChange={(v) =>
              onDataUpdate?.(object.id, { height: parseFloat(v) || 0 })
            }
            type="number"
            disabled={isLocked}
          />
        </Section>
      )}
      {object.type === "ShapeEllipse" && (
        <Section title="Dimensions">
          <EditablePropRow
            label="Radius X"
            value={(object.data as ShapeEllipseData).rx.toFixed(1)}
            onChange={(v) =>
              onDataUpdate?.(object.id, { rx: parseFloat(v) || 0 })
            }
            type="number"
            disabled={isLocked}
          />
          <EditablePropRow
            label="Radius Y"
            value={(object.data as ShapeEllipseData).ry.toFixed(1)}
            onChange={(v) =>
              onDataUpdate?.(object.id, { ry: parseFloat(v) || 0 })
            }
            type="number"
            disabled={isLocked}
          />
        </Section>
      )}
      {object.type === "Symbol" && (
        <Section title="Symbol">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-gray-500">Loop</span>
            <input
              type="checkbox"
              checked={(object.data as SymbolData)?.loop ?? false}
              onChange={(e) =>
                onDataUpdate?.(object.id, { loop: e.target.checked })
              }
              disabled={isLocked}
              className={`h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
            />
          </div>
        </Section>
      )}
      {object.type === "RasterImage" && (
        <Section title="Dimensions">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-gray-500">Width</span>
            <span className="text-xs text-gray-400">
              {(object.data as RasterImageData).width}
            </span>
          </div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-gray-500">Height</span>
            <span className="text-xs text-gray-400">
              {(object.data as RasterImageData).height}
            </span>
          </div>
        </Section>
      )}

      {object.type === "Text" && (
        <Section title="Text">
          <div className="mb-2">
            <span className="mb-1 block text-xs text-gray-500">Content</span>
            <textarea
              value={(object.data as TextData).content}
              onChange={(e) =>
                onDataUpdate?.(object.id, { content: e.target.value })
              }
              onKeyDown={(e) => e.stopPropagation()}
              disabled={isLocked}
              rows={2}
              className={`w-full rounded border border-gray-700 bg-gray-800 px-1.5 py-1 text-xs text-gray-300 focus:border-blue-500 focus:outline-none ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
            />
          </div>
          <EditablePropRow
            label="Font Size"
            value={(object.data as TextData).fontSize.toFixed(0)}
            onChange={(v) =>
              onDataUpdate?.(object.id, { fontSize: parseFloat(v) || 16 })
            }
            type="number"
            disabled={isLocked}
          />
          <EditablePropRow
            label="Font"
            value={(object.data as TextData).fontFamily}
            onChange={(v) => onDataUpdate?.(object.id, { fontFamily: v })}
            type="text"
            disabled={isLocked}
          />
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-gray-500">Weight</span>
            <select
              value={(object.data as TextData).fontWeight}
              onChange={(e) =>
                onDataUpdate?.(object.id, { fontWeight: e.target.value })
              }
              onKeyDown={(e) => e.stopPropagation()}
              disabled={isLocked}
              className={`w-20 rounded border border-gray-700 bg-gray-800 px-1 py-0.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
            </select>
          </div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-gray-500">Align</span>
            <select
              value={(object.data as TextData).textAlign}
              onChange={(e) =>
                onDataUpdate?.(object.id, { textAlign: e.target.value })
              }
              onKeyDown={(e) => e.stopPropagation()}
              disabled={isLocked}
              className={`w-20 rounded border border-gray-700 bg-gray-800 px-1 py-0.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </Section>
      )}

      {/* Style */}
      <Section title="Style">
        <ColorPropRow
          label="Fill"
          value={style.fill && style.fill !== "none" ? style.fill : "#000000"}
          isNone={style.fill === "none"}
          onToggleNone={(none) =>
            handleStyleChange("fill", none ? "none" : "#000000")
          }
          onChange={(v) => handleStyleChange("fill", v)}
          disabled={isLocked}
        />
        <ColorPropRow
          label="Stroke"
          value={
            style.stroke && style.stroke !== "none" ? style.stroke : "#000000"
          }
          isNone={style.stroke === "none"}
          onToggleNone={(none) =>
            handleStyleChange("stroke", none ? "none" : "#000000")
          }
          onChange={(v) => handleStyleChange("stroke", v)}
          disabled={isLocked}
        />
        <EditablePropRow
          label="Stroke W"
          value={style.strokeWidth.toFixed(1)}
          onChange={(v) => handleStyleChange("strokeWidth", parseFloat(v) || 0)}
          type="number"
          disabled={isLocked}
        />
        <EditablePropRow
          label="Opacity"
          value={(style.opacity * 100).toFixed(0)}
          onChange={(v) =>
            handleStyleChange(
              "opacity",
              Math.max(0, Math.min(100, parseFloat(v) || 100)) / 100,
            )
          }
          type="number"
          disabled={isLocked}
        />
      </Section>
    </div>
  );
}

// --- Shared Components ---

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 border-b border-gray-800 pb-3">
      <h4 className="mb-2 text-xs font-medium text-gray-400">{title}</h4>
      {children}
    </div>
  );
}

function EditablePropRow({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number";
  disabled?: boolean;
}) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        disabled={disabled}
        className={`w-20 rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-right text-xs text-gray-300 focus:border-blue-500 focus:outline-none ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      />
    </div>
  );
}

function ColorPropRow({
  label,
  value,
  onChange,
  isNone = false,
  onToggleNone,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isNone?: boolean;
  onToggleNone?: (none: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      {onToggleNone && (
        <button
          onClick={() => onToggleNone(!isNone)}
          disabled={disabled}
          title={
            isNone
              ? `Enable ${label.toLowerCase()}`
              : `Disable ${label.toLowerCase()} (none)`
          }
          className={`flex h-5 w-5 items-center justify-center rounded border text-[9px] font-bold ${
            isNone
              ? "border-gray-600 bg-gray-700 text-gray-500"
              : "border-transparent text-transparent"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {isNone ? "∅" : ""}
        </button>
      )}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-5 w-5 cursor-pointer rounded border border-gray-700 bg-transparent ${isNone || disabled ? "opacity-30" : ""}`}
        disabled={isNone || disabled}
      />
      <span className="text-xs text-gray-400">{label}</span>
      <input
        type="text"
        value={isNone ? "none" : value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className={`ml-auto w-16 rounded border border-gray-700 bg-gray-800 px-1 py-0.5 text-right text-xs text-gray-500 focus:border-blue-500 focus:outline-none ${isNone || disabled ? "italic opacity-50" : ""}`}
        disabled={isNone || disabled}
      />
    </div>
  );
}

function AlignButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      disabled={disabled}
      className={`flex h-7 items-center justify-center rounded transition ${
        disabled
          ? "text-gray-600 cursor-not-allowed"
          : "text-gray-400 hover:bg-gray-800 hover:text-white"
      }`}
    >
      {icon}
    </button>
  );
}
