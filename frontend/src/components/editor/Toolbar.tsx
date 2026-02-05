import type { ReactNode } from "react";

export type Tool = "select" | "rect" | "ellipse" | "pen" | "line" | "hand";

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
};

const tools: { id: Tool; label: string }[] = [
  { id: "select", label: "Select (V)" },
  { id: "rect", label: "Rectangle (R)" },
  { id: "ellipse", label: "Ellipse (O)" },
  { id: "pen", label: "Pen (P)" },
  { id: "line", label: "Line (L)" },
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
