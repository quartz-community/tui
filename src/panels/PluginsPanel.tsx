import { useState, useCallback, useMemo, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { usePlugins } from "../hooks/usePlugins.js";

type SortMode = "config" | "alpha" | "priority";

const SORT_MODES: SortMode[] = ["config", "alpha", "priority"];

type View = "list" | "add" | "confirm-remove" | "order";

interface PluginsPanelProps {
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onFocusChange: (focused: boolean) => void;
  maxHeight?: number;
}

interface PluginSelectOption {
  name: string;
  description: string;
  value?: unknown;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      80,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <text>
      {SPINNER_FRAMES[frame]} {label}
    </text>
  );
}

function ConfirmPrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useKeyboard((event) => {
    if (event.name === "y") onConfirm();
    else if (event.name === "n" || event.name === "escape") onCancel();
  });

  return (
    <text>
      <span fg="#888888">Confirm? (y/n): </span>
    </text>
  );
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getDefaultForKey(
  manifest: Record<string, unknown> | null,
  keyPath: string[],
): unknown | undefined {
  if (!manifest) return undefined;
  const defaults = manifest.defaultOptions as
    | Record<string, unknown>
    | undefined;
  if (!defaults) return undefined;
  let current: unknown = defaults;
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

interface OptionSchemaEntry {
  type: "enum" | "array";
  values?: string[];
  items?: { type: "enum"; values: string[] };
}

function getOptionSchema(
  manifest: Record<string, unknown> | null,
  key: string,
): OptionSchemaEntry | null {
  if (!manifest) return null;
  const schema = manifest.optionSchema as Record<string, unknown> | undefined;
  if (!schema) return null;
  const entry = schema[key];
  if (!entry || typeof entry !== "object") return null;
  return entry as OptionSchemaEntry;
}

function isDefault(current: unknown, defaultVal: unknown): boolean {
  if (defaultVal === undefined) return false;
  return JSON.stringify(current) === JSON.stringify(defaultVal);
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{${entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(", ")}}`;
  }
  return String(value);
}

function isEditableObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCategories(
  category: string | string[] | undefined,
): string[] {
  if (!category) return ["unknown"];
  if (Array.isArray(category))
    return category.length > 0 ? category : ["unknown"];
  return [category];
}

interface CategorizedEntry {
  plugin: ReturnType<typeof usePlugins>["plugins"][number];
  sortedIndex: number;
  category: string;
}

export function PluginsPanel({
  notify,
  onFocusChange,
  maxHeight,
}: PluginsPanelProps) {
  const { plugins, refresh, toggleEnabled, setPluginOrder, setPluginOptions } =
    usePlugins();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<View>("list");
  const [loading, setLoading] = useState(false);
  const [progressMessages, setProgressMessages] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("config");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingSubKey, setEditingSubKey] = useState<string | null>(null);
  const [editingArrayIndex, setEditingArrayIndex] = useState<number | null>(
    null,
  );
  const [listKey, setListKey] = useState(0);
  const [showOptions, setShowOptions] = useState(false);
  const [highlightedOptionIndex, setHighlightedOptionIndex] = useState(0);
  const [addingObjectKey, setAddingObjectKey] = useState(false);
  const [newObjectKeyName, setNewObjectKeyName] = useState<string | null>(null);
  const [highlightedSubKeyIndex, setHighlightedSubKeyIndex] = useState(0);
  const [highlightedArrayItemIndex, setHighlightedArrayItemIndex] = useState(0);
  const [highlightedBoolIndex, setHighlightedBoolIndex] = useState(0);
  const [highlightedEnumIndex, setHighlightedEnumIndex] = useState(0);

  const sortedPlugins = useMemo(() => {
    const sorted = [...plugins];
    sorted.sort((a, b) => {
      const aCat = normalizeCategories(a.category)[0];
      const bCat = normalizeCategories(b.category)[0];
      const catCmp = aCat.localeCompare(bCat);
      if (catCmp !== 0) return catCmp;
      switch (sortMode) {
        case "alpha":
          return a.displayName.localeCompare(b.displayName);
        case "priority":
          return a.order - b.order;
        case "config":
        default:
          return a.index - b.index;
      }
    });
    return sorted;
  }, [plugins, sortMode]);

  const categorizedEntries = useMemo<CategorizedEntry[]>(() => {
    const entries: CategorizedEntry[] = [];
    for (let i = 0; i < sortedPlugins.length; i++) {
      const plugin = sortedPlugins[i];
      const cats = normalizeCategories(plugin.category);
      for (const cat of cats) {
        entries.push({ plugin, sortedIndex: i, category: cat });
      }
    }
    entries.sort((a, b) => {
      const catCmp = a.category.localeCompare(b.category);
      if (catCmp !== 0) return catCmp;
      switch (sortMode) {
        case "alpha":
          return a.plugin.displayName.localeCompare(b.plugin.displayName);
        case "priority":
          return a.plugin.order - b.plugin.order;
        case "config":
        default:
          return a.plugin.index - b.plugin.index;
      }
    });
    return entries;
  }, [sortedPlugins, sortMode]);

  const listOptions = useMemo<PluginSelectOption[]>(() => {
    const result: PluginSelectOption[] = [];
    let lastCategory = "";
    for (let i = 0; i < categorizedEntries.length; i++) {
      const entry = categorizedEntries[i];
      const cat = entry.category;

      if (cat !== lastCategory) {
        result.push({
          name: `── ${cat.toUpperCase()} ──`,
          description: "",
          value: { type: "separator" as const },
        });
        lastCategory = cat;
      }

      const plugin = entry.plugin;
      const status = plugin.enabled ? "● ON " : "○ OFF";
      const configIcon =
        plugin.options &&
        typeof plugin.options === "object" &&
        Object.keys(plugin.options).length > 0
          ? " ⚙"
          : "";
      const orderLabel = ` [${plugin.order}]`;
      const installedLabel = plugin.installed ? "" : " │ NOT INSTALLED";
      result.push({
        name: `  ${status} ${plugin.displayName}${configIcon}${orderLabel}`,
        description: `${plugin.source}${installedLabel}`,
        value: { type: "plugin" as const, sortedIndex: entry.sortedIndex },
      });
    }
    return result;
  }, [categorizedEntries]);

  const resolvePluginIndex = useCallback(
    (selectIdx: number): number | null => {
      const item = listOptions[selectIdx];
      if (!item?.value || typeof item.value !== "object") return null;
      const val = item.value as { type: string; sortedIndex?: number };
      if (val.type === "plugin" && typeof val.sortedIndex === "number")
        return val.sortedIndex;
      return null;
    },
    [listOptions],
  );

  const selectedPlugin = useMemo(() => {
    const pluginIdx = resolvePluginIndex(selectedIndex);
    return pluginIdx !== null ? (sortedPlugins[pluginIdx] ?? null) : null;
  }, [selectedIndex, resolvePluginIndex, sortedPlugins]);

  const enterView = useCallback(
    (v: View) => {
      setView(v);
      onFocusChange(true);
    },
    [onFocusChange],
  );

  const exitView = useCallback(() => {
    setView("list");
    setListKey((k) => k + 1);
    onFocusChange(false);
  }, [onFocusChange]);

  useEffect(() => {
    if (selectedIndex >= sortedPlugins.length) {
      setSelectedIndex(Math.max(0, sortedPlugins.length - 1));
    }
  }, [selectedIndex, sortedPlugins.length]);

  useEffect(() => {
    if (showOptions) {
      setEditingKey(null);
      setEditingSubKey(null);
      setEditingArrayIndex(null);
      setHighlightedOptionIndex(0);
      setHighlightedSubKeyIndex(0);
      setHighlightedArrayItemIndex(0);
      setHighlightedBoolIndex(0);
      setHighlightedEnumIndex(0);
      setAddingObjectKey(false);
      setNewObjectKeyName(null);
    }
  }, [showOptions]);

  useEffect(() => {
    if (view === "confirm-remove" && !selectedPlugin) {
      exitView();
    }
  }, [view, selectedPlugin, exitView]);

  useEffect(() => {
    if (editingKey !== null && selectedPlugin) {
      setHighlightedSubKeyIndex(0);
      setHighlightedArrayItemIndex(0);
      const currentValue = selectedPlugin.options[editingKey];
      setHighlightedBoolIndex(currentValue === true ? 0 : 1);
      const schema = getOptionSchema(
        selectedPlugin.manifest as Record<string, unknown> | null,
        editingKey,
      );
      if (
        schema?.type === "enum" &&
        schema.values &&
        typeof currentValue === "string"
      ) {
        const idx = schema.values.indexOf(currentValue);
        setHighlightedEnumIndex(idx >= 0 ? idx : 0);
      } else {
        setHighlightedEnumIndex(0);
      }
    }
  }, [editingKey, selectedPlugin]);

  useEffect(() => {
    if (editingArrayIndex !== null && editingKey !== null && selectedPlugin) {
      const currentValue = selectedPlugin.options[editingKey];
      if (Array.isArray(currentValue)) {
        const currentItem = currentValue[editingArrayIndex];
        const schema = getOptionSchema(
          selectedPlugin.manifest as Record<string, unknown> | null,
          editingKey,
        );
        if (
          schema?.type === "array" &&
          schema.items?.type === "enum" &&
          schema.items.values &&
          typeof currentItem === "string"
        ) {
          const idx = schema.items.values.indexOf(currentItem);
          setHighlightedEnumIndex(idx >= 0 ? idx : 0);
        }
      }
    }
  }, [editingArrayIndex, editingKey, selectedPlugin]);

  useEffect(() => {
    if (editingSubKey !== null && editingKey !== null && selectedPlugin) {
      const parentValue = selectedPlugin.options[editingKey];
      if (isEditableObject(parentValue)) {
        const subVal = parentValue[editingSubKey];
        setHighlightedBoolIndex(subVal === true ? 0 : 1);
      }
    }
  }, [editingSubKey, editingKey, selectedPlugin]);

  useKeyboard((event) => {
    if (view !== "list" || loading || showOptions) return;

    if (event.name === "s") {
      setSortMode((current: SortMode) => {
        const nextIdx = (SORT_MODES.indexOf(current) + 1) % SORT_MODES.length;
        const next = SORT_MODES[nextIdx];
        setSelectedIndex(0);
        notify(`Sort: ${next}`, "info");
        return next;
      });
    }

    if (event.name === "e" && selectedPlugin) {
      if (!selectedPlugin.enabled) {
        const origIdx = plugins.findIndex(
          (p) => p.index === selectedPlugin.index,
        );
        if (origIdx >= 0) {
          toggleEnabled(origIdx);
          notify(`Enabled ${selectedPlugin.displayName}`, "success");
        }
      }
    }
    if (event.name === "d" && selectedPlugin) {
      if (selectedPlugin.enabled) {
        const origIdx = plugins.findIndex(
          (p) => p.index === selectedPlugin.index,
        );
        if (origIdx >= 0) {
          toggleEnabled(origIdx);
          notify(`Disabled ${selectedPlugin.displayName}`, "success");
        }
      }
    }

    if (event.name === "n") {
      enterView("add");
    }

    if (event.name === "x" && selectedPlugin) {
      enterView("confirm-remove");
    }

    if (event.name === "o" && selectedPlugin) {
      const hasOptions =
        selectedPlugin.options &&
        typeof selectedPlugin.options === "object" &&
        Object.keys(selectedPlugin.options).length > 0;
      if (hasOptions) {
        setShowOptions(true);
        onFocusChange(true);
      } else {
        notify("No options to configure", "info");
      }
    }

    if (event.name === "O" && selectedPlugin) {
      enterView("order");
    }

    if (event.name === "u") {
      setLoading(true);
      setProgressMessages(["→ Updating plugins..."]);
      notify("Updating plugins...", "info");
      import("../lib/cli-bridge.js").then(({ tuiPluginUpdate }) => {
        tuiPluginUpdate(undefined, (msg: string) => {
          setProgressMessages((prev) => [...prev.slice(-20), msg]);
        })
          .then((result) => {
            refresh();
            if (result.success) {
              const count = result.updated?.length ?? 0;
              notify(`Updated ${count} plugin(s)`, "success");
            } else {
              notify("Some updates failed", "error");
            }
          })
          .catch(() => notify("Update failed", "error"))
          .finally(() => {
            setLoading(false);
            setProgressMessages([]);
          });
      });
    }

    if (event.name === "i") {
      setLoading(true);
      setProgressMessages(["→ Installing plugins from lockfile..."]);
      import("../lib/cli-bridge.js").then(({ tuiPluginInstall }) => {
        tuiPluginInstall((msg: string) => {
          setProgressMessages((prev) => [...prev.slice(-20), msg]);
        })
          .then((result) => {
            refresh();
            if (result.success) {
              notify(`Installed ${result.installed ?? 0} plugin(s)`, "success");
            } else {
              notify("Some installs failed", "error");
            }
          })
          .catch(() => notify("Install failed", "error"))
          .finally(() => {
            setLoading(false);
            setProgressMessages([]);
          });
      });
    }
  });

  useKeyboard((event) => {
    if (view !== "add") return;
    if (event.name === "escape") exitView();
  });

  useKeyboard((event) => {
    if (view !== "order") return;
    if (event.name === "escape") exitView();
  });

  useKeyboard((event) => {
    if (!showOptions) return;
    if (event.name === "escape") {
      if (addingObjectKey || newObjectKeyName !== null) {
        setAddingObjectKey(false);
        setNewObjectKeyName(null);
      } else if (editingArrayIndex !== null) {
        setEditingArrayIndex(null);
      } else if (editingSubKey) {
        setEditingSubKey(null);
      } else if (editingKey) {
        setEditingKey(null);
        setAddingObjectKey(false);
        setNewObjectKeyName(null);
      } else {
        setShowOptions(false);
        onFocusChange(false);
      }
    }
    if (!editingKey && selectedPlugin) {
      const optionEntries = Object.entries(selectedPlugin.options);
      const count = optionEntries.length;
      if (count === 0) return;
      if (event.name === "up") {
        setHighlightedOptionIndex((prev) => (prev > 0 ? prev - 1 : count - 1));
      }
      if (event.name === "down") {
        setHighlightedOptionIndex((prev) => (prev < count - 1 ? prev + 1 : 0));
      }
      if (event.name === "return") {
        const key = optionEntries[highlightedOptionIndex]?.[0];
        if (key) {
          setEditingKey(key);
          setEditingSubKey(null);
          setEditingArrayIndex(null);
        }
      }
      if (event.name === "d" && event.shift) {
        const entry = optionEntries[highlightedOptionIndex];
        if (!entry) return;
        const [key] = entry;
        const defaultVal = getDefaultForKey(
          selectedPlugin.manifest as Record<string, unknown> | null,
          [key],
        );
        if (defaultVal === undefined) {
          notify("No default available for this option", "info");
          return;
        }
        const origIdx = plugins.findIndex(
          (p) => p.index === selectedPlugin.index,
        );
        if (origIdx >= 0) {
          setPluginOptions(origIdx, key, defaultVal);
          notify(`Restored ${key} to default`, "success");
        }
      }
    } else if (editingKey && selectedPlugin) {
      const currentValue = selectedPlugin.options[editingKey];

      if (editingSubKey && isEditableObject(currentValue)) {
        const parentValue = currentValue;
        const currentSubValue = parentValue[editingSubKey];
        if (typeof currentSubValue === "boolean") {
          if (event.name === "up" || event.name === "down") {
            setHighlightedBoolIndex((prev) => (prev === 0 ? 1 : 0));
          }
          if (event.name === "return") {
            const newVal = highlightedBoolIndex === 0;
            const origIdx = plugins.findIndex(
              (p) => p.index === selectedPlugin.index,
            );
            if (origIdx >= 0) {
              const updatedParent = { ...parentValue, [editingSubKey]: newVal };
              setPluginOptions(origIdx, editingKey, updatedParent);
              notify(
                `Set ${editingKey}.${editingSubKey} = ${newVal}`,
                "success",
              );
            }
            setEditingSubKey(null);
          }
        }
      } else if (
        editingArrayIndex === null &&
        !editingSubKey &&
        !addingObjectKey &&
        newObjectKeyName === null
      ) {
        if (isEditableObject(currentValue)) {
          const subEntries = Object.entries(currentValue);
          const totalItems = subEntries.length + 1;
          if (event.name === "up") {
            setHighlightedSubKeyIndex((prev) =>
              prev > 0 ? prev - 1 : totalItems - 1,
            );
          }
          if (event.name === "down") {
            setHighlightedSubKeyIndex((prev) =>
              prev < totalItems - 1 ? prev + 1 : 0,
            );
          }
          if (event.name === "return") {
            if (highlightedSubKeyIndex === subEntries.length) {
              setAddingObjectKey(true);
            } else {
              const subKey = subEntries[highlightedSubKeyIndex]?.[0];
              if (subKey) setEditingSubKey(subKey);
            }
          }
          if (
            event.name === "x" &&
            highlightedSubKeyIndex < subEntries.length
          ) {
            const subKey = subEntries[highlightedSubKeyIndex]?.[0];
            if (subKey) {
              const origIdx = plugins.findIndex(
                (p) => p.index === selectedPlugin.index,
              );
              if (origIdx >= 0) {
                const updated = { ...currentValue };
                delete updated[subKey];
                setPluginOptions(origIdx, editingKey, updated);
                notify(`Removed field ${editingKey}.${subKey}`, "success");
                setHighlightedSubKeyIndex((prev) =>
                  prev >= subEntries.length - 1
                    ? Math.max(0, subEntries.length - 2)
                    : prev,
                );
              }
            }
          }
        } else if (Array.isArray(currentValue)) {
          const totalItems = currentValue.length + 1;
          if (event.name === "up" && !event.shift) {
            setHighlightedArrayItemIndex((prev) =>
              prev > 0 ? prev - 1 : totalItems - 1,
            );
          }
          if (event.name === "down" && !event.shift) {
            setHighlightedArrayItemIndex((prev) =>
              prev < totalItems - 1 ? prev + 1 : 0,
            );
          }
          if (event.name === "return") {
            if (highlightedArrayItemIndex === currentValue.length) {
              const origIdx = plugins.findIndex(
                (p) => p.index === selectedPlugin.index,
              );
              if (origIdx >= 0) {
                const newArray = [...currentValue, ""];
                setPluginOptions(origIdx, editingKey, newArray);
                notify(`Added item to ${editingKey}`, "success");
                setEditingArrayIndex(newArray.length - 1);
              }
            } else {
              setEditingArrayIndex(highlightedArrayItemIndex);
            }
          }
          if (
            event.name === "x" &&
            highlightedArrayItemIndex < currentValue.length
          ) {
            const origIdx = plugins.findIndex(
              (p) => p.index === selectedPlugin.index,
            );
            if (origIdx >= 0) {
              const newArray = [...currentValue];
              newArray.splice(highlightedArrayItemIndex, 1);
              setPluginOptions(origIdx, editingKey, newArray);
              notify(
                `Removed ${editingKey}[${highlightedArrayItemIndex}]`,
                "success",
              );
              setHighlightedArrayItemIndex((prev) =>
                prev >= newArray.length
                  ? Math.max(0, newArray.length - 1)
                  : prev,
              );
            }
          }
          if (
            event.name === "up" &&
            event.shift &&
            highlightedArrayItemIndex > 0 &&
            highlightedArrayItemIndex < currentValue.length
          ) {
            const origIdx = plugins.findIndex(
              (p) => p.index === selectedPlugin.index,
            );
            if (origIdx >= 0) {
              const newArray = [...currentValue];
              const idx = highlightedArrayItemIndex;
              [newArray[idx - 1], newArray[idx]] = [
                newArray[idx],
                newArray[idx - 1],
              ];
              setPluginOptions(origIdx, editingKey, newArray);
              setHighlightedArrayItemIndex(idx - 1);
            }
          }
          if (
            event.name === "down" &&
            event.shift &&
            highlightedArrayItemIndex < currentValue.length - 1
          ) {
            const origIdx = plugins.findIndex(
              (p) => p.index === selectedPlugin.index,
            );
            if (origIdx >= 0) {
              const newArray = [...currentValue];
              const idx = highlightedArrayItemIndex;
              [newArray[idx], newArray[idx + 1]] = [
                newArray[idx + 1],
                newArray[idx],
              ];
              setPluginOptions(origIdx, editingKey, newArray);
              setHighlightedArrayItemIndex(idx + 1);
            }
          }
        } else if (typeof currentValue === "boolean") {
          if (event.name === "up" || event.name === "down") {
            setHighlightedBoolIndex((prev) => (prev === 0 ? 1 : 0));
          }
          if (event.name === "return") {
            const newVal = highlightedBoolIndex === 0;
            const origIdx = plugins.findIndex(
              (p) => p.index === selectedPlugin.index,
            );
            if (origIdx >= 0) {
              setPluginOptions(origIdx, editingKey, newVal);
              notify(`Set ${editingKey} = ${newVal}`, "success");
            }
            setEditingKey(null);
          }
        } else {
          const optSchema = getOptionSchema(
            selectedPlugin.manifest as Record<string, unknown> | null,
            editingKey,
          );
          if (optSchema?.type === "enum" && optSchema.values) {
            if (event.name === "up" || event.name === "down") {
              const len = optSchema.values.length;
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
              const newVal = optSchema.values[highlightedEnumIndex];
              const origIdx = plugins.findIndex(
                (p) => p.index === selectedPlugin.index,
              );
              if (origIdx >= 0 && newVal !== undefined) {
                setPluginOptions(origIdx, editingKey, newVal);
                notify(`Set ${editingKey} = ${newVal}`, "success");
              }
              setEditingKey(null);
            }
          }
        }
      } else if (editingArrayIndex !== null && Array.isArray(currentValue)) {
        const optSchema = getOptionSchema(
          selectedPlugin.manifest as Record<string, unknown> | null,
          editingKey,
        );
        if (
          optSchema?.type === "array" &&
          optSchema.items?.type === "enum" &&
          optSchema.items.values
        ) {
          const enumValues = optSchema.items.values;
          if (event.name === "up" || event.name === "down") {
            const len = enumValues.length;
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
            const newVal = enumValues[highlightedEnumIndex];
            const origIdx = plugins.findIndex(
              (p) => p.index === selectedPlugin.index,
            );
            if (origIdx >= 0 && newVal !== undefined) {
              const newArray = [...currentValue];
              newArray[editingArrayIndex] = newVal;
              setPluginOptions(origIdx, editingKey, newArray);
              notify(
                `Set ${editingKey}[${editingArrayIndex}] = ${newVal}`,
                "success",
              );
            }
            setEditingArrayIndex(null);
          }
        }
      }
    }
  });

  const optionSummary = useMemo(() => {
    if (!selectedPlugin?.options || typeof selectedPlugin.options !== "object")
      return "none";
    const keys = Object.keys(selectedPlugin.options);
    if (keys.length === 0) return "none";
    const defaults = (selectedPlugin.manifest as Record<string, unknown> | null)
      ?.defaultOptions as Record<string, unknown> | undefined;
    const summaryParts = keys.map((key) => {
      const val = selectedPlugin.options[key];
      const defVal = defaults ? defaults[key] : undefined;
      const tag = isDefault(val, defVal) ? "" : "*";
      return `${tag}${key}`;
    });
    return summaryParts.join(", ");
  }, [selectedPlugin]);

  if (loading) {
    const progressHeight = maxHeight ? Math.max(3, maxHeight - 5) : undefined;
    return (
      <box flexDirection="column" padding={1} border borderStyle="single">
        <text>
          <strong>Progress</strong>
        </text>
        <box marginTop={1}>
          <Spinner label="Working..." />
        </box>
        <scrollbox
          stickyScroll
          stickyStart="bottom"
          focused
          marginTop={1}
          height={progressHeight}
        >
          <box flexDirection="column">
            {progressMessages.length === 0 ? (
              <text>
                <span fg="#888888">Waiting for updates...</span>
              </text>
            ) : (
              progressMessages.map((message, index) => (
                <text key={`${index}-${message}`}>{message}</text>
              ))
            )}
          </box>
        </scrollbox>
      </box>
    );
  }

  if (view === "add") {
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <strong>Add Plugin</strong>
        </text>
        <text>
          <span fg="#888888">Enter a git source (e.g., github:owner/repo)</span>
        </text>
        <box marginTop={1}>
          <text>Source: </text>
          <box border borderStyle="single" height={3} flexGrow={1}>
            <input
              placeholder="github:owner/plugin-name"
              focused
              onSubmit={(value: string) => {
                const source = value.trim();
                if (!source) {
                  exitView();
                  return;
                }
                exitView();
                setLoading(true);
                setProgressMessages([`→ Adding ${source}...`]);
                import("../lib/cli-bridge.js").then(({ tuiPluginAdd }) => {
                  tuiPluginAdd([source], (msg: string) => {
                    setProgressMessages((prev) => [...prev.slice(-20), msg]);
                  })
                    .then((result) => {
                      refresh();
                      if (result.success) {
                        notify(
                          `Added ${result.installed ?? 0} plugin(s)`,
                          "success",
                        );
                      } else {
                        notify("Failed to add plugin", "error");
                      }
                    })
                    .catch(() => notify("Add failed", "error"))
                    .finally(() => {
                      setLoading(false);
                      setProgressMessages([]);
                    });
                });
              }}
            />
          </box>
        </box>
        <text>
          <span fg="#888888">Enter: confirm │ Esc: cancel</span>
        </text>
      </box>
    );
  }

  if (view === "confirm-remove" && selectedPlugin) {
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <span fg="red">
            <strong>Remove {selectedPlugin.displayName}?</strong>
          </span>
        </text>
        <text>
          <span fg="#888888">Source: {selectedPlugin.source}</span>
        </text>
        <box marginTop={1}>
          <text>Confirm removal? </text>
          <ConfirmPrompt
            onConfirm={() => {
              const pluginName = selectedPlugin.name;
              exitView();
              setLoading(true);
              setProgressMessages([
                `→ Removing ${selectedPlugin.displayName}...`,
              ]);
              import("../lib/cli-bridge.js").then(({ tuiPluginRemove }) => {
                tuiPluginRemove([pluginName], (msg: string) => {
                  setProgressMessages((prev) => [...prev.slice(-20), msg]);
                })
                  .then((result) => {
                    refresh();
                    setSelectedIndex(Math.max(0, selectedIndex - 1));
                    if (result.success) {
                      notify(
                        `Removed ${selectedPlugin.displayName}`,
                        "success",
                      );
                    } else {
                      notify("Remove failed", "error");
                    }
                  })
                  .catch(() => notify("Remove failed", "error"))
                  .finally(() => {
                    setLoading(false);
                    setProgressMessages([]);
                  });
              });
            }}
            onCancel={() => exitView()}
          />
        </box>
      </box>
    );
  }

  if (view === "order" && selectedPlugin) {
    const origIdx = plugins.findIndex((p) => p.index === selectedPlugin.index);
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <strong>Set Order for {selectedPlugin.displayName}</strong>
        </text>
        <text>
          <span fg="#888888">Current: {selectedPlugin.order}</span>
        </text>
        <box marginTop={1}>
          <text>New order: </text>
          <box border borderStyle="single" height={3} flexGrow={1}>
            <input
              placeholder={String(selectedPlugin.order)}
              focused
              onSubmit={(value: string) => {
                const num = parseInt(value, 10);
                if (!isNaN(num) && origIdx >= 0) {
                  setPluginOrder(origIdx, num);
                  notify(`Set order to ${num}`, "success");
                }
                exitView();
              }}
            />
          </box>
        </box>
      </box>
    );
  }

  if (view === "confirm-remove" && !selectedPlugin) {
    exitView();
  }

  const renderOptionsPanel = () => {
    if (!selectedPlugin || !showOptions) return null;

    const optionEntries = Object.entries(selectedPlugin.options);
    const defaults = (selectedPlugin.manifest as Record<string, unknown> | null)
      ?.defaultOptions as Record<string, unknown> | undefined;

    const renderEditPanel = () => {
      if (!editingKey) {
        // Show preview of highlighted option
        const highlightedEntry = optionEntries[highlightedOptionIndex];
        if (!highlightedEntry) {
          return (
            <box
              flexDirection="column"
              border
              borderStyle="single"
              paddingX={1}
            >
              <text>
                <span fg="#888888">Select an option to edit</span>
              </text>
            </box>
          );
        }
        const [hKey, hValue] = highlightedEntry;
        const hDefault = getDefaultForKey(
          selectedPlugin.manifest as Record<string, unknown> | null,
          [hKey],
        );
        const hIsDefault = isDefault(hValue, hDefault);
        const typeLabel = isEditableObject(hValue)
          ? "object"
          : Array.isArray(hValue)
            ? "array"
            : typeof hValue;
        return (
          <box flexDirection="column" border borderStyle="single" paddingX={1}>
            <text>
              <strong>{hKey}</strong>
              <span fg="#888888"> ({typeLabel})</span>
            </text>
            <text>
              <span fg="#888888">Value: </span>
              <span>{formatValue(hValue)}</span>
            </text>
            {hIsDefault ? (
              <text>
                <span fg="cyan">✓ Default value</span>
              </text>
            ) : hDefault !== undefined ? (
              <text>
                <span fg="#555555">Default: {formatValue(hDefault)}</span>
              </text>
            ) : null}
            <box marginTop={1}>
              <text>
                <span fg="#888888">
                  Enter: edit │ D: restore default │ Esc: close options
                </span>
              </text>
            </box>
          </box>
        );
      }

      const currentValue = selectedPlugin.options[editingKey];
      const defaultVal = getDefaultForKey(
        selectedPlugin.manifest as Record<string, unknown> | null,
        [editingKey],
      );
      const isDefaultVal = isDefault(currentValue, defaultVal);

      if (editingKey && editingSubKey && isEditableObject(currentValue)) {
        const parentValue = currentValue;
        const currentSubValue = parentValue[editingSubKey];
        const defaultParent = getDefaultForKey(
          selectedPlugin.manifest as Record<string, unknown> | null,
          [editingKey],
        );
        const defaultSubValue = isEditableObject(defaultParent)
          ? defaultParent[editingSubKey]
          : undefined;
        const isDefaultSub = isDefault(currentSubValue, defaultSubValue);

        if (typeof currentSubValue === "boolean") {
          const boolItems = [
            { label: "true", isCurrent: currentSubValue === true },
            { label: "false", isCurrent: currentSubValue === false },
          ];
          return (
            <box
              flexDirection="column"
              border
              borderStyle="single"
              paddingX={1}
            >
              <text>
                <strong>
                  {editingKey} → {editingSubKey}
                </strong>
                <span fg="#888888"> (boolean)</span>
              </text>
              <text>
                <span fg="#888888">Current: {String(currentSubValue)}</span>
                {isDefaultSub && <span fg="cyan"> (default)</span>}
              </text>
              {defaultSubValue !== undefined && !isDefaultSub && (
                <text>
                  <span fg="#555555">
                    Default: {formatValue(defaultSubValue)}
                  </span>
                </text>
              )}
              <box flexDirection="column" marginTop={1}>
                {boolItems.map((item, i) => {
                  const isHighlighted = i === highlightedBoolIndex;
                  const fg = isHighlighted ? "#FFFFFF" : "#888888";
                  const marker = isHighlighted ? "▸ " : "  ";
                  const currentTag = item.isCurrent ? " ◀" : "";
                  return (
                    <text key={item.label}>
                      <span fg={fg}>
                        {marker}
                        {item.label}
                        {currentTag}
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

        return (
          <box flexDirection="column" border borderStyle="single" paddingX={1}>
            <text>
              <strong>
                {editingKey} → {editingSubKey}
              </strong>
            </text>
            <text>
              <span fg="#888888">Current: {formatValue(currentSubValue)}</span>
              {isDefaultSub && <span fg="cyan"> (default)</span>}
            </text>
            {defaultSubValue !== undefined && !isDefaultSub && (
              <text>
                <span fg="#555555">
                  Default: {formatValue(defaultSubValue)}
                </span>
              </text>
            )}
            <box marginTop={1}>
              <text>New value: </text>
              <box border borderStyle="single" height={3} flexGrow={1}>
                <input
                  placeholder={formatValue(currentSubValue)}
                  focused
                  onSubmit={(value: string) => {
                    const origIdx = plugins.findIndex(
                      (p) => p.index === selectedPlugin.index,
                    );
                    if (origIdx >= 0) {
                      const updatedParent = {
                        ...parentValue,
                        [editingSubKey]: parseJsonOrString(value),
                      };
                      setPluginOptions(origIdx, editingKey, updatedParent);
                      notify(`Set ${editingKey}.${editingSubKey}`, "success");
                    }
                    setEditingSubKey(null);
                  }}
                />
              </box>
            </box>
            <text>
              <span fg="#888888">Enter: save │ Esc: back</span>
            </text>
          </box>
        );
      }

      if (
        editingKey &&
        editingArrayIndex !== null &&
        Array.isArray(currentValue)
      ) {
        const currentItem = currentValue[editingArrayIndex];
        const defaultArr = Array.isArray(defaultVal) ? defaultVal : undefined;
        const defaultItem = defaultArr
          ? defaultArr[editingArrayIndex]
          : undefined;
        const isDefaultItem = isDefault(currentItem, defaultItem);

        const optSchema = getOptionSchema(
          selectedPlugin.manifest as Record<string, unknown> | null,
          editingKey,
        );
        if (
          optSchema?.type === "array" &&
          optSchema.items?.type === "enum" &&
          optSchema.items.values
        ) {
          const enumValues = optSchema.items.values;
          return (
            <box
              flexDirection="column"
              border
              borderStyle="single"
              paddingX={1}
            >
              <text>
                <strong>
                  {editingKey} → [{editingArrayIndex}]
                </strong>
                <span fg="#888888"> (enum)</span>
              </text>
              <text>
                <span fg="#888888">Current: {formatValue(currentItem)}</span>
                {isDefaultItem && <span fg="cyan"> (default)</span>}
              </text>
              {defaultItem !== undefined && !isDefaultItem && (
                <text>
                  <span fg="#555555">Default: {formatValue(defaultItem)}</span>
                </text>
              )}
              <box flexDirection="column" marginTop={1}>
                {enumValues.map((val, i) => {
                  const isHighlighted = i === highlightedEnumIndex;
                  const isCurrent = currentItem === val;
                  const fg = isHighlighted ? "#FFFFFF" : "#888888";
                  const marker = isHighlighted ? "▸ " : "  ";
                  const currentTag = isCurrent ? " ◀" : "";
                  return (
                    <text key={val}>
                      <span fg={fg}>
                        {marker}
                        {val}
                        {currentTag}
                      </span>
                    </text>
                  );
                })}
              </box>
              <text>
                <span fg="#888888">
                  ↑↓: navigate │ Enter: select │ Esc: back
                </span>
              </text>
            </box>
          );
        }

        return (
          <box flexDirection="column" border borderStyle="single" paddingX={1}>
            <text>
              <strong>
                {editingKey} → [{editingArrayIndex}]
              </strong>
            </text>
            <text>
              <span fg="#888888">Current: {formatValue(currentItem)}</span>
              {isDefaultItem && <span fg="cyan"> (default)</span>}
            </text>
            {defaultItem !== undefined && !isDefaultItem && (
              <text>
                <span fg="#555555">Default: {formatValue(defaultItem)}</span>
              </text>
            )}
            <box marginTop={1}>
              <text>New value: </text>
              <box border borderStyle="single" height={3} flexGrow={1}>
                <input
                  placeholder={formatValue(currentItem)}
                  focused
                  onSubmit={(value: string) => {
                    const origIdx = plugins.findIndex(
                      (p) => p.index === selectedPlugin.index,
                    );
                    if (origIdx >= 0) {
                      const newArray = [...currentValue];
                      newArray[editingArrayIndex] = parseJsonOrString(value);
                      setPluginOptions(origIdx, editingKey, newArray);
                      notify(
                        `Set ${editingKey}[${editingArrayIndex}]`,
                        "success",
                      );
                    }
                    setEditingArrayIndex(null);
                  }}
                />
              </box>
            </box>
            <text>
              <span fg="#888888">Enter: save │ Esc: back</span>
            </text>
          </box>
        );
      }

      if (isEditableObject(currentValue)) {
        // Adding a new field: step 2 — enter the value for the new key
        if (newObjectKeyName !== null) {
          return (
            <box
              flexDirection="column"
              border
              borderStyle="single"
              paddingX={1}
            >
              <text>
                <strong>
                  {editingKey} → {newObjectKeyName}
                </strong>
                <span fg="#888888"> (new field)</span>
              </text>
              <box marginTop={1}>
                <text>Value: </text>
                <box border borderStyle="single" height={3} flexGrow={1}>
                  <input
                    key="add-field-value"
                    placeholder="Enter value"
                    focused
                    onSubmit={(value: string) => {
                      const origIdx = plugins.findIndex(
                        (p) => p.index === selectedPlugin.index,
                      );
                      if (origIdx >= 0) {
                        const updatedParent = {
                          ...currentValue,
                          [newObjectKeyName]: parseJsonOrString(value),
                        };
                        setPluginOptions(origIdx, editingKey, updatedParent);
                        notify(
                          `Added ${editingKey}.${newObjectKeyName}`,
                          "success",
                        );
                      }
                      setNewObjectKeyName(null);
                      setAddingObjectKey(false);
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

        // Adding a new field: step 1 — enter the key name
        if (addingObjectKey) {
          return (
            <box
              flexDirection="column"
              border
              borderStyle="single"
              paddingX={1}
            >
              <text>
                <strong>{editingKey}</strong>
                <span fg="#888888"> — Add new field</span>
              </text>
              <box marginTop={1}>
                <text>Key name: </text>
                <box border borderStyle="single" height={3} flexGrow={1}>
                  <input
                    key="add-field-name"
                    placeholder="Enter field name"
                    focused
                    onSubmit={(value: string) => {
                      const keyName = value.trim();
                      if (!keyName) {
                        setAddingObjectKey(false);
                        return;
                      }
                      if (keyName in currentValue) {
                        notify(`Field "${keyName}" already exists`, "error");
                        return;
                      }
                      setNewObjectKeyName(keyName);
                    }}
                  />
                </box>
              </box>
              <text>
                <span fg="#888888">Enter: next │ Esc: cancel</span>
              </text>
            </box>
          );
        }

        const subEntries = Object.entries(currentValue);
        const addFieldLabel = "+ Add field";
        return (
          <box flexDirection="column" border borderStyle="single" paddingX={1}>
            <text>
              <strong>{editingKey}</strong>
              <span fg="#888888"> {`{…} ${subEntries.length} field(s)`}</span>
              {isDefaultVal && <span fg="cyan"> (all defaults)</span>}
            </text>
            <scrollbox>
              <box flexDirection="column">
                {subEntries.map(([subKey, subVal], i) => {
                  const subDefault = isEditableObject(defaultVal)
                    ? defaultVal[subKey]
                    : undefined;
                  const defaultTag = isDefault(subVal, subDefault) ? " ✓" : "";
                  const isHighlighted = i === highlightedSubKeyIndex;
                  const fg = isHighlighted ? "#FFFFFF" : "#888888";
                  const marker = isHighlighted ? "▸ " : "  ";
                  return (
                    <text key={subKey}>
                      <span fg={fg}>
                        {marker}
                        {subKey}
                        {defaultTag}
                      </span>
                      <span fg="#555555"> {formatValue(subVal)}</span>
                    </text>
                  );
                })}
                <text key="__add__">
                  <span
                    fg={
                      highlightedSubKeyIndex === subEntries.length
                        ? "#FFFFFF"
                        : "#888888"
                    }
                  >
                    {highlightedSubKeyIndex === subEntries.length ? "▸ " : "  "}
                    {addFieldLabel}
                  </span>
                </text>
              </box>
            </scrollbox>
            <text>
              <span fg="#888888">
                ↑↓: navigate │ Enter: edit field │ x: delete │ Esc: back
              </span>
            </text>
          </box>
        );
      }

      if (Array.isArray(currentValue)) {
        const addItemLabel = "+ Add item";
        return (
          <box flexDirection="column" border borderStyle="single" paddingX={1}>
            <text>
              <strong>{editingKey}</strong>
              <span fg="#888888"> {`[…] ${currentValue.length} item(s)`}</span>
              {isDefaultVal && <span fg="cyan"> (all defaults)</span>}
            </text>
            <scrollbox>
              <box flexDirection="column">
                {currentValue.map((item, idx) => {
                  const defaultArr = Array.isArray(defaultVal)
                    ? defaultVal
                    : undefined;
                  const defaultItem = defaultArr ? defaultArr[idx] : undefined;
                  const defaultTag = isDefault(item, defaultItem) ? " ✓" : "";
                  const isHighlighted = idx === highlightedArrayItemIndex;
                  const fg = isHighlighted ? "#FFFFFF" : "#888888";
                  const marker = isHighlighted ? "▸ " : "  ";
                  return (
                    <text key={`item-${formatValue(item)}-${idx}`}>
                      <span fg={fg}>
                        {marker}[{idx}]{defaultTag}
                      </span>
                      <span fg="#555555"> {formatValue(item)}</span>
                    </text>
                  );
                })}
                <text key="__add__">
                  <span
                    fg={
                      highlightedArrayItemIndex === currentValue.length
                        ? "#FFFFFF"
                        : "#888888"
                    }
                  >
                    {highlightedArrayItemIndex === currentValue.length
                      ? "▸ "
                      : "  "}
                    {addItemLabel}
                  </span>
                </text>
              </box>
            </scrollbox>
            <text>
              <span fg="#888888">
                ↑↓: navigate │ ⇧↑↓: move │ Enter: edit │ x: delete │ Esc: back
              </span>
            </text>
          </box>
        );
      }

      if (typeof currentValue === "boolean") {
        const boolItems = [
          { label: "true", isCurrent: currentValue === true },
          { label: "false", isCurrent: currentValue === false },
        ];
        return (
          <box flexDirection="column" border borderStyle="single" paddingX={1}>
            <text>
              <strong>{editingKey}</strong>
              <span fg="#888888"> (boolean)</span>
            </text>
            <text>
              <span fg="#888888">Current: {String(currentValue)}</span>
              {isDefaultVal && <span fg="cyan"> (default)</span>}
            </text>
            {defaultVal !== undefined && !isDefaultVal && (
              <text>
                <span fg="#555555">Default: {formatValue(defaultVal)}</span>
              </text>
            )}
            <box flexDirection="column" marginTop={1}>
              {boolItems.map((item, i) => {
                const isHighlighted = i === highlightedBoolIndex;
                const fg = isHighlighted ? "#FFFFFF" : "#888888";
                const marker = isHighlighted ? "▸ " : "  ";
                const currentTag = item.isCurrent ? " ◀" : "";
                return (
                  <text key={item.label}>
                    <span fg={fg}>
                      {marker}
                      {item.label}
                      {currentTag}
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

      const optSchema = getOptionSchema(
        selectedPlugin.manifest as Record<string, unknown> | null,
        editingKey,
      );
      if (optSchema?.type === "enum" && optSchema.values) {
        const enumValues = optSchema.values;
        return (
          <box flexDirection="column" border borderStyle="single" paddingX={1}>
            <text>
              <strong>{editingKey}</strong>
              <span fg="#888888"> (enum)</span>
            </text>
            <text>
              <span fg="#888888">Current: {formatValue(currentValue)}</span>
              {isDefaultVal && <span fg="cyan"> (default)</span>}
            </text>
            {defaultVal !== undefined && !isDefaultVal && (
              <text>
                <span fg="#555555">Default: {formatValue(defaultVal)}</span>
              </text>
            )}
            <box flexDirection="column" marginTop={1}>
              {enumValues.map((val, i) => {
                const isHighlighted = i === highlightedEnumIndex;
                const isCurrent = currentValue === val;
                const fg = isHighlighted ? "#FFFFFF" : "#888888";
                const marker = isHighlighted ? "▸ " : "  ";
                const currentTag = isCurrent ? " ◀" : "";
                return (
                  <text key={val}>
                    <span fg={fg}>
                      {marker}
                      {val}
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

      return (
        <box flexDirection="column" border borderStyle="single" paddingX={1}>
          <text>
            <strong>{editingKey}</strong>
          </text>
          <text>
            <span fg="#888888">Current: {formatValue(currentValue)}</span>
            {isDefaultVal && <span fg="cyan"> (default)</span>}
          </text>
          {defaultVal !== undefined && !isDefaultVal && (
            <text>
              <span fg="#555555">Default: {formatValue(defaultVal)}</span>
            </text>
          )}
          <box marginTop={1}>
            <text>New value: </text>
            <box border borderStyle="single" height={3} flexGrow={1}>
              <input
                placeholder={formatValue(currentValue)}
                focused
                onSubmit={(value: string) => {
                  const origIdx = plugins.findIndex(
                    (p) => p.index === selectedPlugin.index,
                  );
                  if (origIdx >= 0) {
                    const parsed = parseJsonOrString(value);
                    if (
                      typeof currentValue === "number" &&
                      typeof parsed !== "number"
                    ) {
                      notify("Invalid: expected a number", "error");
                      return;
                    }
                    setPluginOptions(origIdx, editingKey, parsed);
                    notify(`Set ${editingKey}`, "success");
                  }
                  setEditingKey(null);
                }}
              />
            </box>
          </box>
          <text>
            <span fg="#888888">Enter: save │ Esc: back</span>
          </text>
        </box>
      );
    };

    const renderOptionsList = () => {
      return (
        <scrollbox>
          <box flexDirection="column">
            {optionEntries.map(([key, value], i) => {
              const defaultVal = defaults ? defaults[key] : undefined;
              const defaultTag = isDefault(value, defaultVal) ? " ✓" : "";
              const typeTag = isEditableObject(value)
                ? " {…}"
                : Array.isArray(value)
                  ? " […]"
                  : "";
              const isActive = editingKey === key;
              const isHighlighted = !editingKey && i === highlightedOptionIndex;
              const fg = isActive
                ? "#FFFF00"
                : isHighlighted
                  ? "#FFFFFF"
                  : "#888888";
              const marker = isActive ? "▶ " : isHighlighted ? "▸ " : "  ";
              return (
                <text key={key}>
                  <span fg={fg}>
                    {marker}
                    {key}
                    {typeTag}
                    {defaultTag}
                  </span>
                </text>
              );
            })}
          </box>
        </scrollbox>
      );
    };

    return (
      <box flexDirection="column" border borderStyle="single" paddingX={1}>
        <text>
          <strong>Options: {selectedPlugin.displayName}</strong>
          <span fg="#888888"> │ Esc: back</span>
        </text>
        {optionEntries.length === 0 ? (
          <text>
            <span fg="#888888">No options configured</span>
          </text>
        ) : (
          <box flexDirection="row" gap={1} flexGrow={1} marginTop={1}>
            <box flexDirection="column" width="35%">
              {renderOptionsList()}
            </box>
            <box flexDirection="column" width="65%">
              {renderEditPanel()}
            </box>
          </box>
        )}
      </box>
    );
  };

  return (
    <box flexDirection="row" gap={1} flexGrow={1}>
      <box flexDirection="column" width="40%" flexGrow={1}>
        <select
          key={`plugins-list-${listKey}`}
          options={listOptions}
          focused={view === "list" && !loading && !showOptions}
          showScrollIndicator
          showDescription
          onChange={(index: number) => {
            setSelectedIndex(index);
            if (showOptions) {
              setShowOptions(false);
              setEditingKey(null);
              setEditingSubKey(null);
              setEditingArrayIndex(null);
              onFocusChange(false);
            }
          }}
          onSelect={(index: number) => setSelectedIndex(index)}
          flexGrow={1}
        />
      </box>
      <box flexDirection="column" width="60%">
        {selectedPlugin ? (
          showOptions ? (
            renderOptionsPanel()
          ) : (
            <box
              flexDirection="column"
              border
              borderStyle="single"
              paddingX={1}
            >
              <text>
                <strong>{selectedPlugin.displayName}</strong>
              </text>
              <box marginTop={1} flexDirection="column">
                <text content={`Source:    ${selectedPlugin.source}`} />
                <text>
                  <span>{`Status:    `}</span>
                  <span fg={selectedPlugin.enabled ? "green" : "red"}>
                    {selectedPlugin.enabled ? "Enabled" : "Disabled"}
                  </span>
                </text>
                <text>
                  <span>{`Installed: `}</span>
                  <span fg={selectedPlugin.installed ? "green" : "red"}>
                    {selectedPlugin.installed ? "Yes" : "No"}
                  </span>
                </text>
                {selectedPlugin.currentCommit && (
                  <text>
                    <span>{`Commit:    ${selectedPlugin.currentCommit.slice(0, 7)}`}</span>
                    {selectedPlugin.modified && (
                      <span fg="yellow"> (modified)</span>
                    )}
                  </text>
                )}
                <text content={`Order:     ${selectedPlugin.order}`} />
                <text
                  content={`Category:  ${Array.isArray(selectedPlugin.category) ? selectedPlugin.category.join(", ") : selectedPlugin.category || "unknown"}`}
                />
                <text
                  content={`Options:   ${optionSummary === "none" ? "none" : `${optionSummary} (o: edit)`}`}
                />
                {optionSummary !== "none" && (
                  <text>
                    <span fg="#555555">
                      {"           * = modified from default"}
                    </span>
                  </text>
                )}
              </box>
            </box>
          )
        ) : (
          <text>
            <span fg="#888888">No plugin selected</span>
          </text>
        )}
      </box>
    </box>
  );
}
