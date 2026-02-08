import { useCallback } from "react";
import type {
  ObjectNode,
  Scene,
  Transform,
  Style,
  ShapeRectData,
  ShapeEllipseData,
  RasterImageData,
} from "../../types/document";

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
}

export function PropertiesPanel({
  selectedObject,
  selectedCount = 0,
  scene,
  onSceneUpdate,
  onObjectUpdate,
  onDataUpdate,
}: PropertiesPanelProps) {
  // Show multi-select summary when multiple objects are selected
  if (!selectedObject && selectedCount > 1) {
    return (
      <div className="w-56 border-l border-gray-800 bg-gray-900 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Properties
        </h3>
        <p className="text-xs text-gray-400">
          {selectedCount} objects selected
        </p>
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
