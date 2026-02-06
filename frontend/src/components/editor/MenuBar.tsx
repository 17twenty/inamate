import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useAuthStore } from "../../stores/authStore";
import { PresenceAvatars } from "../presence/PresenceAvatars";

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: false;
}

interface MenuSeparator {
  separator: true;
}

type MenuEntry = MenuItem | MenuSeparator;

interface MenuBarProps {
  isLocalMode: boolean;
  projectName: string;
  selectedObjectId: string | null;
  onDeleteObject: () => void;
  onSelectAll: () => void;
  onDeselect: () => void;
  onNewDocument: () => void;
  onExportPng: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
  onToggleTimeline: () => void;
  onToggleProperties: () => void;
  // Z-order operations
  onBringToFront: () => void;
  onSendToBack: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
}

export function MenuBar({
  isLocalMode,
  projectName,
  selectedObjectId,
  onDeleteObject,
  onSelectAll,
  onDeselect,
  onNewDocument,
  onExportPng,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onToggleTimeline,
  onToggleProperties,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const menus: { label: string; id: string; items: MenuEntry[] }[] = [
    {
      label: "File",
      id: "file",
      items: [
        {
          label: "New",
          shortcut: isMac() ? "Cmd+N" : "Ctrl+N",
          action: onNewDocument,
        },
        { separator: true },
        { label: "Export as PNG", action: onExportPng },
      ],
    },
    {
      label: "Edit",
      id: "edit",
      items: [
        {
          label: "Undo",
          shortcut: isMac() ? "Cmd+Z" : "Ctrl+Z",
          disabled: true,
        },
        {
          label: "Redo",
          shortcut: isMac() ? "Cmd+Shift+Z" : "Ctrl+Y",
          disabled: true,
        },
        { separator: true },
        {
          label: "Delete",
          shortcut: isMac() ? "Del" : "Delete",
          action: onDeleteObject,
          disabled: !selectedObjectId,
        },
        { separator: true },
        {
          label: "Select All",
          shortcut: isMac() ? "Cmd+A" : "Ctrl+A",
          action: onSelectAll,
        },
        { label: "Deselect", action: onDeselect },
        { separator: true },
        {
          label: "Bring to Front",
          shortcut: isMac() ? "Cmd+Shift+]" : "Ctrl+Shift+]",
          action: onBringToFront,
          disabled: !selectedObjectId,
        },
        {
          label: "Bring Forward",
          shortcut: isMac() ? "Cmd+]" : "Ctrl+]",
          action: onBringForward,
          disabled: !selectedObjectId,
        },
        {
          label: "Send Backward",
          shortcut: isMac() ? "Cmd+[" : "Ctrl+[",
          action: onSendBackward,
          disabled: !selectedObjectId,
        },
        {
          label: "Send to Back",
          shortcut: isMac() ? "Cmd+Shift+[" : "Ctrl+Shift+[",
          action: onSendToBack,
          disabled: !selectedObjectId,
        },
      ],
    },
    {
      label: "View",
      id: "view",
      items: [
        {
          label: "Zoom In",
          shortcut: isMac() ? "Cmd+=" : "Ctrl+=",
          action: onZoomIn,
        },
        {
          label: "Zoom Out",
          shortcut: isMac() ? "Cmd+-" : "Ctrl+-",
          action: onZoomOut,
        },
        {
          label: "Fit to Screen",
          shortcut: isMac() ? "Cmd+0" : "Ctrl+0",
          action: onFitToScreen,
        },
        { separator: true },
        { label: "Toggle Timeline", action: onToggleTimeline },
        { label: "Toggle Properties", action: onToggleProperties },
      ],
    },
  ];

  // Close on outside click
  useEffect(() => {
    if (!openMenu) return;
    function handleClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenu]);

  // Close on Escape
  useEffect(() => {
    if (!openMenu) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenu(null);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [openMenu]);

  const handleMenuClick = useCallback((id: string) => {
    setOpenMenu((prev) => (prev === id ? null : id));
  }, []);

  const handleMenuHover = useCallback(
    (id: string) => {
      if (openMenu && openMenu !== id) {
        setOpenMenu(id);
      }
    },
    [openMenu],
  );

  const handleItemClick = useCallback((item: MenuItem) => {
    if (item.disabled || !item.action) return;
    item.action();
    setOpenMenu(null);
  }, []);

  return (
    <header
      ref={barRef}
      className="flex h-8 items-center justify-between border-b border-gray-800 bg-gray-900 px-1 text-xs select-none"
    >
      {/* Left: menus + project name */}
      <div className="flex items-center">
        {menus.map((menu) => (
          <div key={menu.id} className="relative">
            <button
              onMouseDown={() => handleMenuClick(menu.id)}
              onMouseEnter={() => handleMenuHover(menu.id)}
              className={`rounded px-2.5 py-1 ${
                openMenu === menu.id
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
            >
              {menu.label}
            </button>
            {openMenu === menu.id && (
              <div className="absolute left-0 top-full z-50 mt-0.5 min-w-48 rounded-md border border-gray-700 bg-gray-900 py-1 shadow-xl">
                {menu.items.map((item, i) =>
                  "separator" in item && item.separator ? (
                    <div key={i} className="my-1 border-t border-gray-800" />
                  ) : (
                    <button
                      key={i}
                      onClick={() => handleItemClick(item as MenuItem)}
                      disabled={(item as MenuItem).disabled}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left ${
                        (item as MenuItem).disabled
                          ? "cursor-default text-gray-600"
                          : "text-gray-300 hover:bg-gray-700 hover:text-white"
                      }`}
                    >
                      <span>{(item as MenuItem).label}</span>
                      {(item as MenuItem).shortcut && (
                        <span className="ml-6 text-gray-600">
                          {(item as MenuItem).shortcut}
                        </span>
                      )}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        <span className="ml-3 text-gray-600">|</span>
        <span className="ml-3 text-gray-400">{projectName}</span>
      </div>

      {/* Right: auth / presence */}
      <div className="flex items-center gap-3">
        {isLocalMode ? (
          <button
            onClick={() => navigate("/login")}
            className="rounded px-2 py-0.5 text-gray-500 hover:bg-gray-800 hover:text-white"
          >
            Sign in
          </button>
        ) : (
          <>
            <PresenceAvatars />
            <span className="text-gray-500">{user?.displayName}</span>
            <button
              onClick={logout}
              className="rounded px-2 py-0.5 text-gray-500 hover:bg-gray-800 hover:text-white"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function isMac(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
  );
}
