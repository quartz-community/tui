import { useState, useMemo, useCallback, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { useSettings } from "../hooks/useSettings.js";
import { readDefaultPluginsJson } from "../lib/config.js";

type View =
  | "list"
  | "edit-string"
  | "edit-boolean"
  | "edit-enum"
  | "edit-array"
  | "edit-color";

interface SettingsPanelProps {
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onFocusChange: (focused: boolean) => void;
}

interface FlatEntry {
  keyPath: string[];
  displayKey: string;
  value: unknown;
  depth: number;
  isObject: boolean;
}

interface FieldSchema {
  type: "boolean" | "string" | "enum" | "array" | "number" | "object" | "color";
  enumValues?: string[];
  description?: string;
}

function getFieldSchema(keyPath: string[]): FieldSchema {
  const path = keyPath.join(".");

  if (["enableSPA", "enablePopovers", "theme.cdnCaching"].includes(path)) {
    return { type: "boolean" };
  }

  if (path === "theme.fontOrigin") {
    return { type: "enum", enumValues: ["googleFonts", "local"] };
  }
  if (path === "defaultDateType") {
    return { type: "enum", enumValues: ["created", "modified", "published"] };
  }

  if (path === "ignorePatterns") {
    return { type: "array" };
  }

  if (path.match(/^theme\.colors\.(lightMode|darkMode)\./)) {
    return { type: "color" };
  }

  return { type: "string" };
}

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CSS_COLOR_FUNCTION_REGEX = /^(rgba?|hsla?|hwb|lab|lch|color)\(.+\)$/i;

function isValidColorValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (HEX_COLOR_REGEX.test(trimmed)) return true;
  return CSS_COLOR_FUNCTION_REGEX.test(trimmed);
}

function flattenConfig(
  obj: Record<string, unknown>,
  prefix: string[] = [],
  depth = 0,
): FlatEntry[] {
  const entries: FlatEntry[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const keyPath = [...prefix, key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      entries.push({
        keyPath,
        displayKey: key,
        value,
        depth,
        isObject: true,
      });
      entries.push(
        ...flattenConfig(value as Record<string, unknown>, keyPath, depth + 1),
      );
    } else {
      entries.push({
        keyPath,
        displayKey: key,
        value,
        depth,
        isObject: false,
      });
    }
  }

  return entries;
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function setNestedValue(
  obj: Record<string, unknown>,
  keyPath: string[],
  value: unknown,
): void {
  let current = obj;
  for (let i = 0; i < keyPath.length - 1; i++) {
    if (!(keyPath[i] in current) || typeof current[keyPath[i]] !== "object") {
      current[keyPath[i]] = {};
    }
    current = current[keyPath[i]] as Record<string, unknown>;
  }
  current[keyPath[keyPath.length - 1]] = value;
}

function formatStringValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return String(value);
}

function getDefaultSettingValue(
  defaultConfig: Record<string, unknown> | null,
  keyPath: string[],
): unknown | undefined {
  if (!defaultConfig) return undefined;
  let current: unknown = defaultConfig;
  for (const key of keyPath) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    )
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

export function SettingsPanel({ notify, onFocusChange }: SettingsPanelProps) {
  const { config, updateField } = useSettings();
  const [view, setView] = useState<View>("list");
  const [editingEntry, setEditingEntry] = useState<FlatEntry | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [highlightedBoolIndex, setHighlightedBoolIndex] = useState(0);
  const [highlightedEnumIndex, setHighlightedEnumIndex] = useState(0);
  const [highlightedArrayIndex, setHighlightedArrayIndex] = useState(0);
  const [arrayItems, setArrayItems] = useState<string[]>([]);
  const [addingArrayItem, setAddingArrayItem] = useState(false);
  const [editingArrayItemIndex, setEditingArrayItemIndex] = useState<
    number | null
  >(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const defaultConfig = useMemo(() => {
    const data = readDefaultPluginsJson();
    return (data?.configuration as Record<string, unknown>) ?? null;
  }, []);

  const allEntries = useMemo(() => {
    if (!config) return [];
    return flattenConfig(config);
  }, [config]);

  const visibleEntries = useMemo(() => {
    return allEntries.filter((entry) => {
      for (let i = entry.keyPath.length - 1; i > 0; i--) {
        const parentPath = entry.keyPath.slice(0, i).join(".");
        if (collapsed.has(parentPath)) return false;
      }
      return true;
    });
  }, [allEntries, collapsed]);

  useEffect(() => {
    if (highlightedIndex >= visibleEntries.length) {
      setHighlightedIndex(Math.max(0, visibleEntries.length - 1));
    }
  }, [highlightedIndex, visibleEntries.length]);

  useEffect(() => {
    if (!editingEntry) return;
    const schema = getFieldSchema(editingEntry.keyPath);
    if (schema.type === "boolean") {
      setHighlightedBoolIndex(Boolean(editingEntry.value) ? 0 : 1);
    } else if (schema.type === "enum" && schema.enumValues) {
      const idx = schema.enumValues.indexOf(String(editingEntry.value));
      setHighlightedEnumIndex(idx >= 0 ? idx : 0);
    } else if (schema.type === "array") {
      setHighlightedArrayIndex(0);
    }
  }, [editingEntry]);

  const exitEdit = useCallback(() => {
    setView("list");
    setEditingEntry(null);
    setAddingArrayItem(false);
    setEditingArrayItemIndex(null);
    setColorError(null);
    onFocusChange(false);
  }, [onFocusChange]);

  const applyValue = useCallback(
    (keyPath: string[], value: unknown, exitAfterSave: boolean = true) => {
      if (!config) return;
      if (keyPath.length === 1) {
        updateField(keyPath[0], value);
      } else {
        const fullConfig = { ...config } as Record<string, unknown>;
        setNestedValue(fullConfig, keyPath, value);
        updateField(keyPath[0], fullConfig[keyPath[0]]);
      }

      notify(`Set ${keyPath.join(".")}`, "success");
      if (exitAfterSave) {
        exitEdit();
      }
    },
    [config, updateField, notify, exitEdit],
  );

  const enterEdit = useCallback(
    (entry: FlatEntry) => {
      const schema = getFieldSchema(entry.keyPath);
      setEditingEntry(entry);
      setAddingArrayItem(false);
      setEditingArrayItemIndex(null);
      if (schema.type === "boolean") {
        setHighlightedBoolIndex(Boolean(entry.value) ? 0 : 1);
        setView("edit-boolean");
      } else if (schema.type === "enum") {
        if (schema.enumValues) {
          const idx = schema.enumValues.indexOf(String(entry.value));
          setHighlightedEnumIndex(idx >= 0 ? idx : 0);
        }
        setView("edit-enum");
      } else if (schema.type === "array") {
        setArrayItems(
          Array.isArray(entry.value) ? entry.value.map(String) : [],
        );
        setHighlightedArrayIndex(0);
        setView("edit-array");
      } else if (schema.type === "color") {
        setColorError(null);
        setView("edit-color");
      } else {
        setView("edit-string");
      }
      onFocusChange(true);
    },
    [onFocusChange],
  );

  useKeyboard((event) => {
    if (view !== "list") return;

    const count = visibleEntries.length;
    if (count === 0) return;

    if (event.name === "up") {
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : count - 1));
    }
    if (event.name === "down") {
      setHighlightedIndex((prev) => (prev < count - 1 ? prev + 1 : 0));
    }
    if (event.name === "return") {
      const entry = visibleEntries[highlightedIndex];
      if (!entry) return;
      if (entry.isObject) {
        const path = entry.keyPath.join(".");
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }
          return next;
        });
      } else {
        enterEdit(entry);
      }
    }
    if (event.name === "d" && event.shift) {
      const entry = visibleEntries[highlightedIndex];
      if (!entry) return;
      const defaultValue = getDefaultSettingValue(defaultConfig, entry.keyPath);
      if (defaultValue === undefined) {
        notify("No default available for " + entry.keyPath.join("."), "error");
        return;
      }
      if (deepEqual(entry.value, defaultValue)) {
        notify(entry.keyPath.join(".") + " is already default", "info");
        return;
      }
      applyValue(entry.keyPath, defaultValue);
      notify("Restored " + entry.keyPath.join(".") + " to default", "success");
    }
  });

  useKeyboard((event) => {
    if (view !== "edit-boolean" || !editingEntry) return;
    if (event.name === "escape") {
      exitEdit();
      return;
    }
    if (event.name === "up" || event.name === "down") {
      setHighlightedBoolIndex((prev) => (prev === 0 ? 1 : 0));
    }
    if (event.name === "return") {
      const newVal = highlightedBoolIndex === 0;
      applyValue(editingEntry.keyPath, newVal);
    }
  });

  useKeyboard((event) => {
    if (view !== "edit-enum" || !editingEntry) return;
    const schema = getFieldSchema(editingEntry.keyPath);
    const enumValues = schema.type === "enum" ? (schema.enumValues ?? []) : [];
    if (event.name === "escape") {
      exitEdit();
      return;
    }
    if (event.name === "up" || event.name === "down") {
      const len = enumValues.length;
      if (len === 0) return;
      setHighlightedEnumIndex((prev) =>
        event.name === "up"
          ? prev > 0
            ? prev - 1
            : len - 1
          : prev < len - 1
            ? prev + 1
            : 0,
      );
    }
    if (event.name === "return") {
      const selected = enumValues[highlightedEnumIndex];
      if (selected !== undefined) {
        applyValue(editingEntry.keyPath, selected);
      }
    }
  });

  useKeyboard((event) => {
    if (view !== "edit-array" || !editingEntry) return;

    if (addingArrayItem || editingArrayItemIndex !== null) {
      if (event.name === "escape") {
        setAddingArrayItem(false);
        setEditingArrayItemIndex(null);
      }
      return;
    }

    if (event.name === "escape") {
      exitEdit();
      return;
    }

    const count = arrayItems.length;
    if (event.name === "up" && count > 0 && !event.shift) {
      setHighlightedArrayIndex((prev) => (prev > 0 ? prev - 1 : count - 1));
    }
    if (event.name === "down" && count > 0 && !event.shift) {
      setHighlightedArrayIndex((prev) => (prev < count - 1 ? prev + 1 : 0));
    }
    if (event.name === "n") {
      setAddingArrayItem(true);
    }
    if (event.name === "return" && count > 0) {
      setEditingArrayItemIndex(highlightedArrayIndex);
    }
    if (event.name === "x" && count > 0) {
      const nextItems = arrayItems.filter(
        (_, i) => i !== highlightedArrayIndex,
      );
      setArrayItems(nextItems);
      setHighlightedArrayIndex(
        Math.max(0, Math.min(highlightedArrayIndex, nextItems.length - 1)),
      );
      applyValue(editingEntry.keyPath, nextItems, false);
    }
    if (event.name === "up" && event.shift && highlightedArrayIndex > 0) {
      const nextItems = [...arrayItems];
      const idx = highlightedArrayIndex;
      [nextItems[idx - 1], nextItems[idx]] = [
        nextItems[idx],
        nextItems[idx - 1],
      ];
      setArrayItems(nextItems);
      setHighlightedArrayIndex(idx - 1);
      applyValue(editingEntry.keyPath, nextItems, false);
    }
    if (
      event.name === "down" &&
      event.shift &&
      highlightedArrayIndex < count - 1
    ) {
      const nextItems = [...arrayItems];
      const idx = highlightedArrayIndex;
      [nextItems[idx], nextItems[idx + 1]] = [
        nextItems[idx + 1],
        nextItems[idx],
      ];
      setArrayItems(nextItems);
      setHighlightedArrayIndex(idx + 1);
      applyValue(editingEntry.keyPath, nextItems, false);
    }
  });

  useKeyboard((event) => {
    if (view !== "edit-string" && view !== "edit-color") return;
    if (event.name === "escape") exitEdit();
  });

  if (!config) {
    return (
      <box padding={1}>
        <text>
          <span fg="#888888">
            No configuration found. Run `quartz create` first.
          </span>
        </text>
      </box>
    );
  }

  const renderTree = (dimmed: boolean) => {
    const baseFg = dimmed ? "#666666" : "#888888";
    const highlightFg = dimmed ? "#AAAAAA" : "#FFFFFF";

    const renderedEntries = visibleEntries.map((entry, idx) => {
      const indent = "  ".repeat(entry.depth);
      const isHighlighted = idx === highlightedIndex;
      const marker = isHighlighted ? "▸ " : "  ";

      if (entry.isObject) {
        const isCollapsed = collapsed.has(entry.keyPath.join("."));
        const arrow = isCollapsed ? "▸" : "▾";
        return (
          <text key={entry.keyPath.join(".")}>
            {isHighlighted ? (
              <span fg={highlightFg}>
                <strong>
                  {marker}
                  {indent}
                  {entry.displayKey}: {arrow}
                </strong>
              </span>
            ) : (
              <span fg={baseFg}>
                {marker}
                {indent}
                {entry.displayKey}: {arrow}
              </span>
            )}
          </text>
        );
      }

      const schema = getFieldSchema(entry.keyPath);
      let valueText = "";
      let valueFg: string | null = null;
      let swatchColor: string | null = null;

      if (schema.type === "boolean") {
        const enabled = Boolean(entry.value);
        valueText = enabled ? "● true" : "○ false";
        valueFg = enabled ? "green" : "red";
      } else if (schema.type === "enum") {
        valueText = String(entry.value ?? "");
      } else if (schema.type === "array") {
        const length = Array.isArray(entry.value) ? entry.value.length : 0;
        valueText = `[${length} items]`;
      } else if (schema.type === "color") {
        const colorValue = String(entry.value ?? "");
        valueText = colorValue;
        swatchColor = isValidColorValue(colorValue) ? colorValue : null;
      } else {
        valueText = formatStringValue(entry.value);
      }

      const displayFg = isHighlighted
        ? (valueFg ?? highlightFg)
        : (valueFg ?? baseFg);
      const isDefault =
        !entry.isObject &&
        deepEqual(
          entry.value,
          getDefaultSettingValue(defaultConfig, entry.keyPath),
        );
      const defaultTag = isDefault ? " (default)" : "";

      return (
        <text key={entry.keyPath.join(".")}>
          {isHighlighted ? (
            <span fg={highlightFg}>
              <strong>
                {marker}
                {indent}
                {entry.displayKey}:
              </strong>
            </span>
          ) : (
            <span fg={baseFg}>
              {marker}
              {indent}
              {entry.displayKey}:
            </span>
          )}
          {swatchColor ? <span fg={swatchColor}>█ </span> : null}
          <span fg={displayFg}>
            {isHighlighted ? (
              <strong>
                {valueText}
                {defaultTag}
              </strong>
            ) : (
              <>
                {valueText}
                <span fg="#555555">{defaultTag}</span>
              </>
            )}
          </span>
        </text>
      );
    });

    return (
      <scrollbox>
        <box flexDirection="column">{renderedEntries}</box>
      </scrollbox>
    );
  };

  const renderEditPanel = () => {
    if (!editingEntry) return null;
    const schema = getFieldSchema(editingEntry.keyPath);
    const pathLabel = editingEntry.keyPath.join(".");

    if (view === "edit-boolean") {
      const boolItems = [
        { label: "true", isCurrent: Boolean(editingEntry.value) === true },
        { label: "false", isCurrent: Boolean(editingEntry.value) === false },
      ];
      return (
        <box flexDirection="column" paddingX={1}>
          <text>
            <strong>Edit: {pathLabel}</strong>
          </text>
          <box flexDirection="column" marginTop={1}>
            {boolItems.map((item, i) => {
              const isHighlighted = i === highlightedBoolIndex;
              const fg = isHighlighted ? "#FFFFFF" : "#888888";
              const marker = isHighlighted ? "▸ " : "  ";
              return (
                <text key={item.label}>
                  <span fg={fg}>
                    {marker}
                    {item.label}
                    {item.isCurrent ? " (current)" : ""}
                  </span>
                </text>
              );
            })}
          </box>
          <text>
            <span fg="#888888">↑↓: toggle │ Enter: select │ Esc: back</span>
          </text>
        </box>
      );
    }

    if (view === "edit-enum" && schema.type === "enum") {
      const enumValues = schema.enumValues ?? [];
      return (
        <box flexDirection="column" paddingX={1}>
          <text>
            <strong>Edit: {pathLabel}</strong>
          </text>
          <box flexDirection="column" marginTop={1}>
            {enumValues.map((value, i) => {
              const isHighlighted = i === highlightedEnumIndex;
              const fg = isHighlighted ? "#FFFFFF" : "#888888";
              const marker = isHighlighted ? "▸ " : "  ";
              const currentTag =
                value === String(editingEntry.value) ? " (current)" : "";
              return (
                <text key={value}>
                  <span fg={fg}>
                    {marker}
                    {value}
                    {currentTag}
                  </span>
                </text>
              );
            })}
          </box>
          <text>
            <span fg="#888888">↑↓: navigate │ Enter: select │ Esc: back</span>
          </text>
        </box>
      );
    }

    if (view === "edit-array") {
      const hasItems = arrayItems.length > 0;
      const controlsLabel =
        "n: add │ x: delete │ Shift+↑/↓: reorder │ Esc: back";
      const editingLabel =
        editingArrayItemIndex !== null ? "Edit item:" : "New item:";
      const placeholder =
        editingArrayItemIndex !== null
          ? (arrayItems[editingArrayItemIndex] ?? "")
          : "pattern";
      const showInput = addingArrayItem || editingArrayItemIndex !== null;

      const arrayLines = hasItems
        ? arrayItems.map((value, index) => {
            const isHighlighted = index === highlightedArrayIndex;
            const fg = isHighlighted ? "#FFFFFF" : "#888888";
            const marker = isHighlighted ? "▸ " : "  ";
            return (
              <text key={`${index}-${value}`}>
                <span fg={fg}>
                  {marker}
                  {JSON.stringify(value)}
                </span>
              </text>
            );
          })
        : [
            <text key="__empty__">
              <span fg="#888888">(no items)</span>
            </text>,
          ];

      return (
        <box flexDirection="column" paddingX={1}>
          <text>
            <strong>Edit: {pathLabel}</strong>
          </text>
          <scrollbox>
            <box flexDirection="column">{arrayLines}</box>
          </scrollbox>
          <box marginTop={1}>
            <text>{editingLabel} </text>
            <box border borderStyle="single" height={3} flexGrow={1}>
              <input
                placeholder={placeholder}
                focused={showInput}
                onSubmit={(value: string) => {
                  const trimmed = value.trim();
                  if (!trimmed) {
                    setAddingArrayItem(false);
                    setEditingArrayItemIndex(null);
                    return;
                  }
                  if (editingArrayItemIndex !== null) {
                    const nextItems = [...arrayItems];
                    nextItems[editingArrayItemIndex] = trimmed;
                    setArrayItems(nextItems);
                    applyValue(editingEntry.keyPath, nextItems, false);
                    setEditingArrayItemIndex(null);
                    return;
                  }
                  const nextItems = [...arrayItems, trimmed];
                  setArrayItems(nextItems);
                  setHighlightedArrayIndex(Math.max(0, nextItems.length - 1));
                  applyValue(editingEntry.keyPath, nextItems, false);
                  setAddingArrayItem(false);
                }}
              />
            </box>
          </box>
          <text>
            <span fg="#888888">{controlsLabel}</span>
          </text>
        </box>
      );
    }

    if (view === "edit-color") {
      const currentValue = String(editingEntry.value ?? "");
      const showSwatch = isValidColorValue(currentValue);
      const errorText = colorError ?? "";
      return (
        <box flexDirection="column" paddingX={1}>
          <text>
            <strong>Edit: {pathLabel}</strong>
          </text>
          <text>
            <span fg="#888888">Current: {currentValue}</span>
            {showSwatch ? <span fg={currentValue}> █</span> : null}
          </text>
          <box marginTop={1}>
            <text>Value: </text>
            <box border borderStyle="single" height={3} flexGrow={1}>
              <input
                placeholder={currentValue}
                focused
                onSubmit={(value: string) => {
                  const trimmed = value.trim();
                  if (!isValidColorValue(trimmed)) {
                    setColorError(
                      "Invalid color. Use #RGB, #RRGGBB, #RRGGBBAA, or a CSS color function like rgba(...)",
                    );
                    return;
                  }
                  setColorError(null);
                  applyValue(editingEntry.keyPath, trimmed);
                }}
              />
            </box>
          </box>
          <text>
            <span fg={errorText ? "red" : "#888888"}>{errorText}</span>
          </text>
          <text>
            <span fg="#888888">Enter: save │ Esc: cancel</span>
          </text>
        </box>
      );
    }

    if (view === "edit-string") {
      const currentLabel = formatStringValue(editingEntry.value);
      return (
        <box flexDirection="column" paddingX={1}>
          <text>
            <strong>Edit: {pathLabel}</strong>
          </text>
          <text>
            <span fg="#888888">Current: {currentLabel}</span>
          </text>
          <box marginTop={1} flexDirection="row">
            <text>Value: </text>
            <box border borderStyle="single" height={3} flexGrow={1}>
              <input
                placeholder={currentLabel}
                focused
                onSubmit={(value: string) => {
                  const parsed = parseJsonOrString(value);
                  applyValue(editingEntry.keyPath, parsed);
                }}
              />
            </box>
          </box>
          <text>
            <span fg="#888888">Enter: save │ Esc: cancel</span>
          </text>
        </box>
      );
    }

    return null;
  };

  if (view !== "list" && editingEntry) {
    return (
      <box flexDirection="row" paddingX={1} gap={1} flexGrow={1}>
        <box flexDirection="column" flexGrow={1}>
          <text>
            <strong>Global Configuration</strong>
          </text>
          <box
            flexDirection="column"
            border
            borderStyle="single"
            paddingX={1}
            marginTop={1}
            flexGrow={1}
          >
            {renderTree(true)}
          </box>
        </box>
        <box
          flexDirection="column"
          border
          borderStyle="single"
          paddingX={1}
          flexGrow={1}
        >
          {renderEditPanel()}
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingX={1} flexGrow={1}>
      <text>
        <strong>Global Configuration</strong>
      </text>
      <box
        flexDirection="column"
        border
        borderStyle="single"
        paddingX={1}
        marginTop={1}
        flexGrow={1}
      >
        {renderTree(false)}
      </box>
      <text>
        <span fg="#888888">
          ↑↓: navigate │ Enter: edit/expand │ Shift+D: restore default
        </span>
      </text>
    </box>
  );
}
