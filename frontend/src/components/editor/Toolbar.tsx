import type { ReactNode } from "react";

export type Tool =
  | "select"
  | "subselect"
  | "rect"
  | "ellipse"
  | "pen"
  | "line"
  | "text"
  | "hand"
  | "shear"
  | "zoom";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
}

const iconSize = 18;

const icons: Record<Tool, ReactNode> = {
  select: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 2l5 14 2-5.5L15.5 9z" />
    </svg>
  ),
  subselect: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 2l5 14 2-5.5L15.5 9z" strokeDasharray="3 2" />
    </svg>
  ),
  rect: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="12" height="10" rx="1" />
    </svg>
  ),
  ellipse: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="9" cy="9" rx="7" ry="5" />
    </svg>
  ),
  pen: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 15l3-1.5L14.5 5a1.4 1.4 0 00-2-2L4.5 11.5z" />
      <path d="M10.5 5l2 2" />
    </svg>
  ),
  line: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <line x1="3" y1="15" x2="15" y2="3" />
    </svg>
  ),
  text: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h10" />
      <path d="M9 4v11" />
      <path d="M6.5 15h5" />
    </svg>
  ),
  hand: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 8V3.5a1 1 0 012 0V8" />
      <path d="M8.5 7V2.5a1 1 0 012 0V8" />
      <path d="M10.5 7.5V4a1 1 0 012 0v5" />
      <path d="M12.5 8V6.5a1 1 0 012 0v4a5 5 0 01-5 5h-1a5 5 0 01-4-2l-2-2.5a1 1 0 011.5-1.3L6.5 13V8" />
    </svg>
  ),
  shear: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3h9v12H3V3h3" />
      <path d="M3 15L6 3" />
      <path d="M15 15V3" />
    </svg>
  ),
  zoom: (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="5" />
      <line x1="12" y1="12" x2="16" y2="16" />
      <line x1="6" y1="8" x2="10" y2="8" />
      <line x1="8" y1="6" x2="8" y2="10" />
    </svg>
  ),
};

const tools: { id: Tool; label: string }[] = [
  { id: "select", label: "Select (V)" },
  { id: "subselect", label: "Direct Select (A)" },
  { id: "rect", label: "Rectangle (R)" },
  { id: "ellipse", label: "Ellipse (O)" },
  { id: "pen", label: "Pen (P)" },
  { id: "line", label: "Line (L)" },
  { id: "text", label: "Text (T)" },
  { id: "shear", label: "Shear (S)" },
  { id: "zoom", label: "Zoom (Z)" },
  { id: "hand", label: "Hand (H)" },
];

export function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  return (
    <div className="flex w-10 flex-col items-center gap-1 border-r border-gray-800 bg-gray-900 py-2">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          title={tool.label}
          aria-label={tool.label}
          className={`flex h-8 w-8 items-center justify-center rounded transition ${
            activeTool === tool.id
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:bg-gray-800 hover:text-white"
          }`}
        >
          {icons[tool.id]}
        </button>
      ))}
    </div>
  );
}
