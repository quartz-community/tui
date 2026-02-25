import { useState, useMemo, useCallback, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { usePlugins, type EnrichedPlugin } from "../hooks/usePlugins.js";
import { useLayout } from "../hooks/useLayout.js";

type SelectOption = { name: string; description: string; value?: unknown };

const ZONES = [
  "header",
  "left",
  "beforeBody",
  "afterBody",
  "right",
  "footer",
] as const;
type Zone = (typeof ZONES)[number];

type View =
  | "zones"
  | "move-zone"
  | "edit-priority"
  | "edit-display"
  | "edit-condition"
  | "confirm-remove-layout"
  | "groups"
  | "page-types";

interface LayoutPanelProps {
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onFocusChange: (focused: boolean) => void;
}

interface ZoneComponent {
  pluginIndex: number;
  name: string;
  displayName: string;
  position: string;
  priority: number;
  display: string;
  condition?: string;
  group?: string;
  groupOptions?: Record<string, unknown>;
}

interface PageTypeOverride {
  exclude?: string[];
  positions?: Record<string, unknown>;
}

interface LayoutConfig {
  groups?: Record<string, Record<string, unknown>>;
  byPageType?: Record<string, PageTypeOverride>;
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

function getZoneComponents(
  plugins: EnrichedPlugin[],
): Record<Zone, ZoneComponent[]> {
  const zones: Record<Zone, ZoneComponent[]> = {
    header: [],
    left: [],
    beforeBody: [],
    right: [],
    afterBody: [],
    footer: [],
  };

  for (const plugin of plugins) {
    if (!plugin.layout || !plugin.enabled) continue;
    const position = plugin.layout.position as Zone;
    if (!(position in zones)) continue;
    zones[position].push({
      pluginIndex: plugin.index,
      name: plugin.name,
      displayName: plugin.displayName,
      position: plugin.layout.position,
      priority: plugin.layout.priority,
      display: plugin.layout.display ?? "all",
      condition: plugin.layout.condition,
      group: plugin.layout.group,
      groupOptions: plugin.layout.groupOptions,
    });
  }

  for (const zone of ZONES) {
    zones[zone].sort((a, b) => a.priority - b.priority);
  }

  return zones;
}

export function LayoutPanel({ notify, onFocusChange }: LayoutPanelProps) {
  const { plugins, updateLayout, refresh: refreshPlugins } = usePlugins();
  const { layout, save: saveLayout } = useLayout();
  const { height: termRows } = useTerminalDimensions();

  const [focusColumn, setFocusColumn] = useState<number>(1);
  const [focusCenterRow, setFocusCenterRow] = useState<number>(0);
  const [drillMode, setDrillMode] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState(0);
  const [view, setView] = useState<View>("zones");
  const [listKey, setListKey] = useState(0);
  const [activePageType, setActivePageType] = useState<string>("default");

  const layoutConfig = (layout ?? {}) as LayoutConfig;
  const pageTypes = useMemo(() => {
    const types = ["default"];
    if (layoutConfig.byPageType) {
      for (const key of Object.keys(layoutConfig.byPageType)) {
        if (!types.includes(key)) types.push(key);
      }
    }
    return types;
  }, [layoutConfig.byPageType]);

  const zoneComponents = useMemo(() => {
    const base = getZoneComponents(plugins);
    if (activePageType === "default") return base;

    const override = layoutConfig.byPageType?.[activePageType];
    if (!override) return base;

    const filtered: Record<Zone, ZoneComponent[]> = {
      header: [],
      left: [],
      beforeBody: [],
      right: [],
      afterBody: [],
      footer: [],
    };
    for (const zone of ZONES) {
      filtered[zone] = base[zone].filter(
        (comp) => !override.exclude?.includes(comp.name),
      );
      if (override.positions) {
        for (const [pluginName, newPosition] of Object.entries(
          override.positions,
        )) {
          if (typeof newPosition === "string" && newPosition === zone) {
            for (const srcZone of ZONES) {
              const comp = base[srcZone].find((c) => c.name === pluginName);
              if (comp && !filtered[zone].find((c) => c.name === pluginName)) {
                filtered[zone].push({ ...comp, position: zone });
              }
            }
          }
          if (typeof newPosition === "string" && newPosition !== zone) {
            filtered[zone] = filtered[zone].filter(
              (c) => c.name !== pluginName,
            );
          }
        }
      }
      filtered[zone].sort((a, b) => a.priority - b.priority);
    }
    return filtered;
  }, [plugins, activePageType, layoutConfig.byPageType]);

  // terminal layout arithmetic: title(1) + tabs(1) + helpbar(1) + statusbar(1) + padding(1) = 5
  // each zone box: border(2) + zone-title(1) = 3 overhead
  const maxItemsForZone = useCallback(
    (zone: Zone): number => {
      const pageTypeBarHeight = pageTypes.length > 1 ? 1 : 0;
      const panelHeight = termRows - 5 - pageTypeBarHeight;
      if (zone === "left" || zone === "right") {
        return Math.max(1, panelHeight - 3);
      }
      // 4 center zones × 3 overhead each = 12 lines
      const contentLines = Math.max(4, panelHeight - 12);
      return Math.max(1, Math.floor(contentLines / 4));
    },
    [termRows, pageTypes.length],
  );
  const getActiveZone = useCallback((): Zone => {
    if (focusColumn === 0) return "left";
    if (focusColumn === 2) return "right";
    return (["header", "beforeBody", "afterBody", "footer"] as const)[
      focusCenterRow
    ];
  }, [focusColumn, focusCenterRow]);
  const currentZone = getActiveZone();
  const currentComponents = zoneComponents[currentZone];
  const selectedComp = currentComponents[selectedComponent] ?? null;

  useEffect(() => {
    if (selectedComponent > Math.max(0, currentComponents.length - 1)) {
      setSelectedComponent(Math.max(0, currentComponents.length - 1));
    }
  }, [currentComponents.length, selectedComponent]);

  useEffect(() => {
    if (!drillMode && currentZone) {
      setSelectedComponent(0);
    }
  }, [drillMode, currentZone]);

  const componentOptions = useMemo<SelectOption[]>(
    () =>
      currentComponents.map((comp) => {
        const groupLabel = comp.group ? ` [${comp.group}]` : "";
        return {
          name: `${String(comp.priority).padStart(3)} ${comp.displayName}${groupLabel}`,
          description: `display: ${comp.display}${comp.condition ? ` │ condition: ${comp.condition}` : ""}`,
          value: comp.pluginIndex,
        };
      }),
    [currentComponents],
  );

  const enterView = useCallback(
    (next: View) => {
      setView(next);
      onFocusChange(true);
    },
    [onFocusChange],
  );

  const exitView = useCallback(() => {
    setView("zones");
    setDrillMode(false);
    setListKey((k) => k + 1);
    onFocusChange(false);
  }, [onFocusChange]);

  const findPluginArrayIndex = useCallback(
    (pluginIndex: number) => {
      return plugins.findIndex((p) => p.index === pluginIndex);
    },
    [plugins],
  );

  useKeyboard((event) => {
    if (view !== "zones") return;

    if (!drillMode) {
      if (event.name === "left") {
        setFocusColumn((current) => Math.max(0, current - 1));
        return;
      }
      if (event.name === "right") {
        setFocusColumn((current) => Math.min(2, current + 1));
        return;
      }
      if (event.name === "up" && focusColumn === 1) {
        setFocusCenterRow((current) => Math.max(0, current - 1));
        return;
      }
      if (event.name === "down" && focusColumn === 1) {
        setFocusCenterRow((current) => Math.min(3, current + 1));
        return;
      }
      if (event.name === "return") {
        setDrillMode(true);
        return;
      }
      if (event.name === "g") {
        enterView("groups");
      }
      if (event.name === "t") {
        enterView("page-types");
      }
      if (event.name === "[" && pageTypes.length > 1) {
        setActivePageType((current) => {
          const idx = pageTypes.indexOf(current);
          return pageTypes[(idx - 1 + pageTypes.length) % pageTypes.length];
        });
      }
      if (event.name === "]" && pageTypes.length > 1) {
        setActivePageType((current) => {
          const idx = pageTypes.indexOf(current);
          return pageTypes[(idx + 1) % pageTypes.length];
        });
      }
      return;
    }

    if (event.name === "escape") {
      setDrillMode(false);
      setSelectedComponent(0);
      return;
    }

    if (event.name === "m" && selectedComp) {
      enterView("move-zone");
    }

    if (event.name === "p" && selectedComp) {
      enterView("edit-priority");
    }

    if (event.name === "v" && selectedComp) {
      enterView("edit-display");
    }

    if (event.name === "c" && selectedComp) {
      enterView("edit-condition");
    }

    if (event.name === "x" && selectedComp) {
      enterView("confirm-remove-layout");
    }

    if (event.name === "d" && event.shift && selectedComp) {
      const arrIdx = findPluginArrayIndex(selectedComp.pluginIndex);
      if (arrIdx >= 0) {
        const plugin = plugins[arrIdx];
        const manifest = plugin.manifest as Record<string, unknown> | null;
        const components = manifest?.components as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (components) {
          const compEntry = Object.values(components)[0];
          if (compEntry) {
            const defaultPosition =
              (compEntry.defaultPosition as string) || "left";
            const defaultPriority = (compEntry.defaultPriority as number) || 50;
            updateLayout(arrIdx, {
              position: defaultPosition,
              priority: defaultPriority,
              display: "all",
            });
            notify(
              `Restored ${selectedComp.displayName} to defaults`,
              "success",
            );
          } else {
            notify("No component defaults found in manifest", "error");
          }
        } else {
          // No manifest components — restore sensible defaults
          updateLayout(arrIdx, {
            position: selectedComp.position,
            priority: 50,
            display: "all",
          });
          notify(
            `Reset ${selectedComp.displayName} display settings`,
            "success",
          );
        }
      }
    }

    if (
      event.name === "up" &&
      event.shift &&
      selectedComp &&
      selectedComponent > 0
    ) {
      const above = currentComponents[selectedComponent - 1];
      const arrIdx = findPluginArrayIndex(selectedComp.pluginIndex);
      const aboveArrIdx = findPluginArrayIndex(above.pluginIndex);
      if (arrIdx >= 0 && aboveArrIdx >= 0) {
        const myPlugin = plugins[arrIdx];
        const abovePlugin = plugins[aboveArrIdx];
        if (myPlugin.layout && abovePlugin.layout) {
          updateLayout(arrIdx, {
            ...myPlugin.layout,
            priority: above.priority,
          });
          updateLayout(aboveArrIdx, {
            ...abovePlugin.layout,
            priority: selectedComp.priority,
          });
          setSelectedComponent(selectedComponent - 1);
          notify("Moved up", "success");
        }
      }
    }

    if (
      event.name === "down" &&
      event.shift &&
      selectedComp &&
      selectedComponent < currentComponents.length - 1
    ) {
      const below = currentComponents[selectedComponent + 1];
      const arrIdx = findPluginArrayIndex(selectedComp.pluginIndex);
      const belowArrIdx = findPluginArrayIndex(below.pluginIndex);
      if (arrIdx >= 0 && belowArrIdx >= 0) {
        const myPlugin = plugins[arrIdx];
        const belowPlugin = plugins[belowArrIdx];
        if (myPlugin.layout && belowPlugin.layout) {
          updateLayout(arrIdx, {
            ...myPlugin.layout,
            priority: below.priority,
          });
          updateLayout(belowArrIdx, {
            ...belowPlugin.layout,
            priority: selectedComp.priority,
          });
          setSelectedComponent(selectedComponent + 1);
          notify("Moved down", "success");
        }
      }
    }
  });

  useKeyboard((event) => {
    if (view !== "edit-priority" && view !== "edit-condition") return;
    if (event.name === "escape") exitView();
  });

  if (view === "move-zone" && selectedComp) {
    const otherZones = ZONES.filter((z) => z !== currentZone);
    return (
      <MoveZoneView
        component={selectedComp}
        fromZone={currentZone}
        zones={otherZones}
        onSelect={(newZone) => {
          const arrIdx = findPluginArrayIndex(selectedComp.pluginIndex);
          if (arrIdx >= 0) {
            const plugin = plugins[arrIdx];
            if (plugin.layout) {
              updateLayout(arrIdx, { ...plugin.layout, position: newZone });
              notify(
                `Moved ${selectedComp.displayName} to ${newZone}`,
                "success",
              );
              setSelectedComponent(0);
            }
          }
          exitView();
        }}
        onCancel={exitView}
      />
    );
  }

  if (view === "edit-priority" && selectedComp) {
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <span fg="#888888">
            {currentZone} › {selectedComp.displayName} › Priority
          </span>
        </text>
        <text>
          <strong>Set Priority: {selectedComp.displayName}</strong>
        </text>
        <text>
          <span fg="#888888">
            Current: {selectedComp.priority} (lower = higher in zone)
          </span>
        </text>
        <box marginTop={1}>
          <text>Priority: </text>
          <box border borderStyle="single" height={3} flexGrow={1}>
            <input
              placeholder={String(selectedComp.priority)}
              focused
              onSubmit={(value: string) => {
                const num = parseInt(value, 10);
                if (!isNaN(num)) {
                  const arrIdx = findPluginArrayIndex(selectedComp.pluginIndex);
                  if (arrIdx >= 0) {
                    const plugin = plugins[arrIdx];
                    if (plugin.layout) {
                      updateLayout(arrIdx, { ...plugin.layout, priority: num });
                      notify(`Priority set to ${num}`, "success");
                    }
                  }
                }
                exitView();
              }}
            />
          </box>
        </box>
      </box>
    );
  }

  if (view === "edit-display" && selectedComp) {
    return (
      <DisplayModeView
        component={selectedComp}
        fromZone={currentZone}
        onSelect={(mode) => {
          const arrIdx = findPluginArrayIndex(selectedComp.pluginIndex);
          if (arrIdx >= 0) {
            const plugin = plugins[arrIdx];
            if (plugin.layout) {
              updateLayout(arrIdx, { ...plugin.layout, display: mode });
              notify(`Display set to ${mode}`, "success");
            }
          }
          exitView();
        }}
        onCancel={exitView}
      />
    );
  }

  if (view === "edit-condition" && selectedComp) {
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <span fg="#888888">
            {currentZone} › {selectedComp.displayName} › Condition
          </span>
        </text>
        <text>
          <strong>Set Condition: {selectedComp.displayName}</strong>
        </text>
        <text>
          <span fg="#888888">
            Available: not-index, has-tags, has-backlinks, has-toc (or empty to
            remove)
          </span>
        </text>
        <box marginTop={1}>
          <text>Condition: </text>
          <box border borderStyle="single" height={3} flexGrow={1}>
            <input
              placeholder={selectedComp.condition ?? ""}
              focused
              onSubmit={(value: string) => {
                const arrIdx = findPluginArrayIndex(selectedComp.pluginIndex);
                if (arrIdx >= 0) {
                  const plugin = plugins[arrIdx];
                  if (plugin.layout) {
                    const newLayout = { ...plugin.layout };
                    if (value.trim()) {
                      newLayout.condition = value.trim();
                    } else {
                      delete newLayout.condition;
                    }
                    updateLayout(arrIdx, newLayout);
                    notify(
                      value.trim()
                        ? `Condition set to ${value.trim()}`
                        : "Condition removed",
                      "success",
                    );
                  }
                }
                exitView();
              }}
            />
          </box>
        </box>
      </box>
    );
  }

  if (view === "confirm-remove-layout" && selectedComp) {
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <span fg="#888888">
            {currentZone} › {selectedComp.displayName}
          </span>
        </text>
        <text>
          <span fg="red">
            <strong>Remove {selectedComp.displayName} from layout?</strong>
          </span>
        </text>
        <text>
          <span fg="#888888">
            The plugin will remain installed but won't appear in the layout.
          </span>
        </text>
        <box marginTop={1}>
          <text>Confirm removal? </text>
          <ConfirmPrompt
            onConfirm={() => {
              const arrIdx = findPluginArrayIndex(selectedComp.pluginIndex);
              if (arrIdx >= 0) {
                updateLayout(arrIdx, null);
                setSelectedComponent(Math.max(0, selectedComponent - 1));
                notify(
                  `Removed ${selectedComp.displayName} from layout`,
                  "success",
                );
              }
              exitView();
            }}
            onCancel={() => exitView()}
          />
        </box>
      </box>
    );
  }

  if (view === "groups") {
    return (
      <GroupsView
        layout={layout}
        onSave={(newLayout) => {
          saveLayout(newLayout);
          refreshPlugins();
          notify("Groups updated", "success");
          exitView();
        }}
        onCancel={exitView}
      />
    );
  }

  if (view === "page-types") {
    return (
      <PageTypesView
        layout={layout}
        plugins={plugins}
        notify={notify}
        onSave={(newLayout) => {
          saveLayout(newLayout);
        }}
        onCancel={exitView}
      />
    );
  }

  const renderZoneBox = (zone: Zone) => {
    const comps = zoneComponents[zone];
    const isFocused = getActiveZone() === zone;
    const isDrilledIn = isFocused && drillMode;
    const maxItems = maxItemsForZone(zone);
    const visibleComps = comps.slice(0, maxItems);
    const overflowCount = comps.length - visibleComps.length;

    return (
      <>
        <text>
          {isFocused ? (
            <span fg="cyan">
              <strong>
                {zone} ({comps.length})
              </strong>
            </span>
          ) : (
            <span fg="#888888">
              {zone} ({comps.length})
            </span>
          )}
        </text>
        {isDrilledIn ? (
          comps.length === 0 ? (
            <text>
              <span fg="#555555">Empty zone</span>
            </text>
          ) : (
            <select
              key={`${zone}-${listKey}`}
              options={componentOptions}
              focused
              onChange={(index: number) => setSelectedComponent(index)}
              showDescription
              showScrollIndicator
              flexGrow={1}
            />
          )
        ) : comps.length === 0 ? (
          <text>
            <span fg="#555555">empty</span>
          </text>
        ) : (
          <box flexDirection="column">
            {visibleComps.map((comp) => (
              <text key={comp.name}>
                <span
                  fg={isFocused ? "#AAAAAA" : "#666666"}
                >{` ${comp.displayName}`}</span>
              </text>
            ))}
            {overflowCount > 0 && (
              <text>
                <span fg="#555555">+{overflowCount} more</span>
              </text>
            )}
          </box>
        )}
      </>
    );
  };

  return (
    <box flexDirection="column" flexGrow={1}>
      {pageTypes.length > 1 && (
        <box flexDirection="row" paddingX={1} gap={1}>
          <text>
            <span fg="#888888">Page type:</span>
          </text>
          {pageTypes.map((pt) => (
            <text key={pt}>
              {pt === activePageType ? (
                <span fg="yellow">
                  <strong>[{pt}]</strong>
                </span>
              ) : (
                <span fg="#666666">{pt}</span>
              )}
            </text>
          ))}
        </box>
      )}
      <box flexDirection="row" flexGrow={1}>
        <box
          flexDirection="column"
          width="20%"
          border
          borderStyle="single"
          borderFg={getActiveZone() === "left" ? "cyan" : undefined}
          paddingX={1}
        >
          {renderZoneBox("left")}
        </box>

        <box flexDirection="column" width="60%" paddingX={1}>
          <box
            border
            borderStyle="single"
            borderFg={getActiveZone() === "header" ? "cyan" : undefined}
            paddingX={1}
            marginBottom={0}
          >
            {renderZoneBox("header")}
          </box>
          <box
            border
            borderStyle="single"
            borderFg={getActiveZone() === "beforeBody" ? "cyan" : undefined}
            paddingX={1}
            flexGrow={1}
          >
            {renderZoneBox("beforeBody")}
          </box>
          <box
            border
            borderStyle="single"
            borderFg={getActiveZone() === "afterBody" ? "cyan" : undefined}
            paddingX={1}
            flexGrow={1}
          >
            {renderZoneBox("afterBody")}
          </box>
          <box
            border
            borderStyle="single"
            borderFg={getActiveZone() === "footer" ? "cyan" : undefined}
            paddingX={1}
            marginTop={0}
          >
            {renderZoneBox("footer")}
          </box>
        </box>

        <box
          flexDirection="column"
          width="20%"
          border
          borderStyle="single"
          borderFg={getActiveZone() === "right" ? "cyan" : undefined}
          paddingX={1}
        >
          {renderZoneBox("right")}
        </box>
      </box>

      <box paddingX={1} marginTop={1}>
        <text>
          <span fg="#888888">
            {drillMode
              ? "↑↓ select │ ⇧↑↓ reorder │ m move │ p priority │ v display │ c condition │ x remove │ ⇧D restore │ Esc: back"
              : `←→ columns │ ↑↓ zones │ Enter: edit zone │ g groups │ t page-types${pageTypes.length > 1 ? " │ [ prev / ] next page type" : ""}`}
          </span>
        </text>
      </box>
    </box>
  );
}

interface MoveZoneViewProps {
  component: ZoneComponent;
  fromZone: Zone;
  zones: readonly Zone[];
  onSelect: (zone: Zone) => void;
  onCancel: () => void;
}

function MoveZoneView({
  component,
  fromZone,
  zones,
  onSelect,
  onCancel,
}: MoveZoneViewProps) {
  useKeyboard((event) => {
    if (event.name === "escape") onCancel();
  });

  const zoneOptions: SelectOption[] = zones.map((zone) => ({
    name: zone,
    description: "",
    value: zone,
  }));

  return (
    <box flexDirection="column" padding={1}>
      <text>
        <span fg="#888888">
          {fromZone} › {component.displayName} › Move
        </span>
      </text>
      <text>
        <strong>Move {component.displayName} to zone:</strong>
      </text>
      <select
        options={zoneOptions}
        focused
        onSelect={(_index: number, option: SelectOption | null) => {
          const zone = option?.value as Zone | undefined;
          if (zone) onSelect(zone);
        }}
        showDescription={false}
      />
      <text>
        <span fg="#888888">Enter: select │ Esc: cancel</span>
      </text>
    </box>
  );
}

interface DisplayModeViewProps {
  component: ZoneComponent;
  fromZone: Zone;
  onSelect: (mode: string) => void;
  onCancel: () => void;
}

const DISPLAY_MODES = ["all", "desktop-only", "mobile-only"] as const;

function DisplayModeView({
  component,
  fromZone,
  onSelect,
  onCancel,
}: DisplayModeViewProps) {
  useKeyboard((event) => {
    if (event.name === "escape") onCancel();
  });

  const modeOptions: SelectOption[] = DISPLAY_MODES.map((mode) => ({
    name: mode,
    description: mode === component.display ? "(current)" : "",
    value: mode,
  }));

  return (
    <box flexDirection="column" padding={1}>
      <text>
        <span fg="#888888">
          {fromZone} › {component.displayName} › Display
        </span>
      </text>
      <text>
        <strong>Display mode for {component.displayName}:</strong>
      </text>
      <select
        options={modeOptions}
        focused
        onSelect={(_index: number, option: SelectOption | null) => {
          const mode = option?.value as string | undefined;
          if (mode) onSelect(mode);
        }}
        showDescription
        showScrollIndicator={false}
      />
      <text>
        <span fg="#888888">Enter: select │ Esc: cancel</span>
      </text>
    </box>
  );
}

interface GroupsViewProps {
  layout: Record<string, unknown> | null;
  onSave: (layout: Record<string, unknown>) => void;
  onCancel: () => void;
}

type GroupsMode = "list" | "add" | "confirm-delete" | "edit";

function GroupsView({ layout, onSave, onCancel }: GroupsViewProps) {
  const groups =
    (layout as { groups?: Record<string, Record<string, unknown>> })?.groups ??
    {};
  const groupEntries = Object.entries(groups);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<GroupsMode>("list");
  const [editField, setEditField] = useState<"direction" | "gap" | null>(null);

  const selectedGroup = groupEntries[selected] ?? null;

  useKeyboard((event) => {
    if (mode !== "list") return;

    if (event.name === "escape") {
      onCancel();
      return;
    }
    if (event.name === "n") {
      setMode("add");
    }
    if (event.name === "d" && selectedGroup) {
      setMode("confirm-delete");
    }
  });

  useKeyboard((event) => {
    if (mode !== "edit") return;
    if (event.name === "escape") {
      setMode("list");
      setEditField(null);
    }
  });

  useKeyboard((event) => {
    if (mode !== "add") return;
    if (event.name === "escape") setMode("list");
  });

  if (mode === "add") {
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <strong>Add Group</strong>
        </text>
        <box marginTop={1}>
          <text>Name: </text>
          <box border borderStyle="single" height={3} flexGrow={1}>
            <input
              placeholder="group-name"
              focused
              onSubmit={(value: string) => {
                if (value.trim()) {
                  const newLayout = { ...(layout ?? {}) };
                  const currentGroups =
                    ((newLayout as Record<string, unknown>).groups as Record<
                      string,
                      Record<string, unknown>
                    >) ?? {};
                  currentGroups[value.trim()] = {
                    direction: "row",
                    gap: "0.5rem",
                  };
                  (newLayout as Record<string, unknown>).groups = currentGroups;
                  onSave(newLayout);
                } else {
                  setMode("list");
                }
              }}
            />
          </box>
        </box>
      </box>
    );
  }

  if (mode === "confirm-delete" && selectedGroup) {
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <span fg="red">
            <strong>Delete group "{selectedGroup[0]}"?</strong>
          </span>
        </text>
        <box marginTop={1}>
          <ConfirmPrompt
            onConfirm={() => {
              const newLayout = { ...(layout ?? {}) };
              const currentGroups = {
                ...(((newLayout as Record<string, unknown>).groups as Record<
                  string,
                  Record<string, unknown>
                >) ?? {}),
              };
              delete currentGroups[selectedGroup[0]];
              (newLayout as Record<string, unknown>).groups = currentGroups;
              onSave(newLayout);
            }}
            onCancel={() => setMode("list")}
          />
        </box>
      </box>
    );
  }

  if (mode === "edit" && selectedGroup && editField) {
    const [groupName, groupConfig] = selectedGroup;
    const currentValue = String(
      (groupConfig as Record<string, unknown>)[editField] ?? "",
    );

    return (
      <box flexDirection="column" padding={1}>
        <text>
          <strong>
            Edit {groupName} → {editField}
          </strong>
        </text>
        <text>
          <span fg="#888888">
            {editField === "direction"
              ? 'Values: "row" or "column"'
              : 'Value: CSS gap (e.g. "0.5rem")'}
          </span>
        </text>
        <box marginTop={1}>
          <text>{editField}: </text>
          <box border borderStyle="single" height={3} flexGrow={1}>
            <input
              placeholder={currentValue}
              focused
              onSubmit={(value: string) => {
                const newLayout = { ...(layout ?? {}) };
                const currentGroups = {
                  ...(((newLayout as Record<string, unknown>).groups as Record<
                    string,
                    Record<string, unknown>
                  >) ?? {}),
                };
                currentGroups[groupName] = {
                  ...currentGroups[groupName],
                  [editField]: value,
                };
                (newLayout as Record<string, unknown>).groups = currentGroups;

                if (editField === "direction") {
                  setEditField("gap");
                } else {
                  onSave(newLayout);
                }
              }}
            />
          </box>
        </box>
      </box>
    );
  }

  const groupOptions: SelectOption[] = groupEntries.map(([name, config]) => {
    const cfg = config as Record<string, unknown>;
    return {
      name,
      description: `direction=${String(cfg.direction ?? "row")} gap=${String(cfg.gap ?? "0")}`,
      value: name,
    };
  });

  return (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>Layout Groups</strong>
      </text>
      {groupEntries.length === 0 ? (
        <text>
          <span fg="#888888">No groups defined</span>
        </text>
      ) : (
        <select
          options={groupOptions}
          focused
          onChange={(index: number) => setSelected(Math.max(0, index))}
          onSelect={() => {
            if (!selectedGroup) return;
            setMode("edit");
            setEditField("direction");
          }}
          showDescription
          showScrollIndicator
        />
      )}
      <box marginTop={1}>
        <text>
          <span fg="#888888">Enter: edit │ n: new │ d: delete │ Esc: back</span>
        </text>
      </box>
    </box>
  );
}

interface PageTypesViewProps {
  layout: Record<string, unknown> | null;
  plugins: EnrichedPlugin[];
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onSave: (layout: Record<string, unknown>) => void;
  onCancel: () => void;
}

type PageTypesMode =
  | "list"
  | "add"
  | "confirm-delete"
  | "detail"
  | "exclude"
  | "positions";

function PageTypesView({
  layout,
  plugins,
  notify,
  onSave,
  onCancel,
}: PageTypesViewProps) {
  const layoutConfig = (layout ?? {}) as LayoutConfig;
  const byPageType = layoutConfig.byPageType ?? {};
  const pageTypeEntries = Object.entries(byPageType);

  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<PageTypesMode>("list");

  const selectedEntry = pageTypeEntries[selected] ?? null;
  const selectedPageType = selectedEntry?.[0] ?? null;
  const selectedOverride = (selectedEntry?.[1] ?? {}) as PageTypeOverride;

  const updatePageType = useCallback(
    (
      pageType: string,
      updater: (current: PageTypeOverride) => PageTypeOverride,
    ) => {
      const newLayout = { ...(layout ?? {}) };
      const currentByPageType = {
        ...(((newLayout as LayoutConfig).byPageType as Record<
          string,
          PageTypeOverride
        >) ?? {}),
      };
      const current = { ...(currentByPageType[pageType] ?? {}) };
      const next = updater(current);

      if (next.exclude && next.exclude.length === 0) delete next.exclude;
      if (next.positions && Object.keys(next.positions).length === 0)
        delete next.positions;

      currentByPageType[pageType] = next;
      (newLayout as LayoutConfig).byPageType = currentByPageType;
      onSave(newLayout);
    },
    [layout, onSave],
  );

  useKeyboard((event) => {
    if (mode !== "list") return;

    if (event.name === "escape") {
      onCancel();
      return;
    }
    if (event.name === "n") {
      setMode("add");
    }
    if (event.name === "d" && selectedEntry) {
      setMode("confirm-delete");
    }
  });

  useKeyboard((event) => {
    if (mode !== "detail") return;
    if (event.name === "escape") setMode("list");
  });

  useKeyboard((event) => {
    if (mode !== "add") return;
    if (event.name === "escape") setMode("list");
  });

  if (mode === "add") {
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <strong>Add Page Type Override</strong>
        </text>
        <box marginTop={1}>
          <text>Name: </text>
          <box border borderStyle="single" height={3} flexGrow={1}>
            <input
              placeholder="page-type"
              focused
              onSubmit={(value: string) => {
                const name = value.trim();
                if (!name) {
                  setMode("list");
                  return;
                }

                if (byPageType[name]) {
                  notify(`Page type "${name}" already exists`, "error");
                  setMode("list");
                  return;
                }

                const newLayout = { ...(layout ?? {}) };
                const currentByPageType = {
                  ...(((newLayout as LayoutConfig).byPageType as Record<
                    string,
                    PageTypeOverride
                  >) ?? {}),
                };
                currentByPageType[name] = {};
                (newLayout as LayoutConfig).byPageType = currentByPageType;
                onSave(newLayout);
                setSelected(pageTypeEntries.length);
                setMode("list");
              }}
            />
          </box>
        </box>
      </box>
    );
  }

  if (mode === "confirm-delete" && selectedPageType) {
    return (
      <box flexDirection="column" padding={1}>
        <text>
          <span fg="red">
            <strong>Delete page type "{selectedPageType}"?</strong>
          </span>
        </text>
        <box marginTop={1}>
          <ConfirmPrompt
            onConfirm={() => {
              const newLayout = { ...(layout ?? {}) };
              const currentByPageType = {
                ...(((newLayout as LayoutConfig).byPageType as Record<
                  string,
                  PageTypeOverride
                >) ?? {}),
              };
              delete currentByPageType[selectedPageType];
              (newLayout as LayoutConfig).byPageType = currentByPageType;
              onSave(newLayout);
              setSelected(Math.max(0, selected - 1));
              setMode("list");
            }}
            onCancel={() => setMode("list")}
          />
        </box>
      </box>
    );
  }

  if (mode === "exclude" && selectedPageType) {
    return (
      <PageTypeExcludeView
        pageType={selectedPageType}
        exclude={selectedOverride.exclude ?? []}
        plugins={plugins}
        onUpdate={(nextExclude) => {
          updatePageType(selectedPageType, (current) => ({
            ...current,
            exclude: nextExclude,
          }));
        }}
        onCancel={() => setMode("detail")}
      />
    );
  }

  if (mode === "positions" && selectedPageType) {
    return (
      <PageTypePositionsView
        pageType={selectedPageType}
        positions={selectedOverride.positions ?? {}}
        plugins={plugins}
        onUpdate={(nextPositions) => {
          updatePageType(selectedPageType, (current) => ({
            ...current,
            positions: nextPositions,
          }));
        }}
        onCancel={() => setMode("detail")}
      />
    );
  }

  if (mode === "detail" && selectedPageType) {
    const excludeCount = selectedOverride.exclude?.length ?? 0;
    const positionsCount = selectedOverride.positions
      ? Object.keys(selectedOverride.positions).length
      : 0;

    const options: SelectOption[] = [
      {
        name: `Excluded plugins (${excludeCount} excluded)`,
        description: "",
        value: "exclude",
      },
      {
        name: `Position overrides (${positionsCount} overrides)`,
        description: "",
        value: "positions",
      },
    ];

    return (
      <box flexDirection="column" padding={1}>
        <text>
          <strong>Edit page type "{selectedPageType}"</strong>
        </text>
        <select
          options={options}
          focused
          onSelect={(_index: number, option: SelectOption | null) => {
            if (option?.value === "exclude") setMode("exclude");
            if (option?.value === "positions") setMode("positions");
          }}
          showDescription={false}
          showScrollIndicator={false}
        />
        <box marginTop={1}>
          <text>
            <span fg="#888888">Enter: select │ Esc: back</span>
          </text>
        </box>
      </box>
    );
  }

  const pageTypeOptions: SelectOption[] = pageTypeEntries.map(
    ([name, override]) => {
      const cfg = override as PageTypeOverride;
      const excludeCount = cfg.exclude?.length ?? 0;
      const positionsCount = cfg.positions
        ? Object.keys(cfg.positions).length
        : 0;
      return {
        name,
        description: `(${excludeCount} excluded, ${positionsCount} position override${
          positionsCount === 1 ? "" : "s"
        })`,
        value: name,
      };
    },
  );

  return (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>Page Type Overrides</strong>
      </text>
      {pageTypeEntries.length === 0 ? (
        <text>
          <span fg="#888888">No page types configured</span>
        </text>
      ) : (
        <select
          options={pageTypeOptions}
          focused
          onChange={(index: number) => setSelected(Math.max(0, index))}
          onSelect={() => {
            if (!selectedEntry) return;
            setMode("detail");
          }}
          showDescription
          showScrollIndicator
        />
      )}
      <box marginTop={1}>
        <text>
          <span fg="#888888">Enter: edit │ n: new │ d: delete │ Esc: back</span>
        </text>
      </box>
    </box>
  );
}

interface PageTypeExcludeViewProps {
  pageType: string;
  exclude: string[];
  plugins: EnrichedPlugin[];
  onUpdate: (nextExclude: string[]) => void;
  onCancel: () => void;
}

function PageTypeExcludeView({
  pageType,
  exclude,
  plugins,
  onUpdate,
  onCancel,
}: PageTypeExcludeViewProps) {
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled);

  useKeyboard((event) => {
    if (event.name === "escape") onCancel();
  });

  const options: SelectOption[] = enabledPlugins.map((plugin) => {
    const isExcluded = exclude.includes(plugin.name);
    return {
      name: plugin.displayName,
      description: isExcluded ? "excluded" : "included",
      value: plugin.name,
    };
  });

  return (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>Excluded plugins for "{pageType}":</strong>
      </text>
      {enabledPlugins.length === 0 ? (
        <text>
          <span fg="#888888">No enabled plugins</span>
        </text>
      ) : (
        <select
          options={options}
          focused
          onSelect={(_index: number, option: SelectOption | null) => {
            const name = option?.value as string | undefined;
            if (!name) return;
            const isExcluded = exclude.includes(name);
            const nextExclude = isExcluded
              ? exclude.filter((item) => item !== name)
              : [...exclude, name];
            onUpdate(nextExclude);
          }}
          showDescription
          showScrollIndicator
        />
      )}
      <box marginTop={1}>
        <text>
          <span fg="#888888">Enter: toggle │ Esc: back</span>
        </text>
      </box>
    </box>
  );
}

interface PageTypePositionsViewProps {
  pageType: string;
  positions: Record<string, unknown>;
  plugins: EnrichedPlugin[];
  onUpdate: (nextPositions: Record<string, unknown>) => void;
  onCancel: () => void;
}

type PositionEntry =
  | { kind: "plugin"; pluginName: string; position: string }
  | { kind: "clear"; zone: string; count: number };

type PositionMode = "list" | "add-plugin" | "select-position";

function PageTypePositionsView({
  pageType,
  positions,
  plugins,
  onUpdate,
  onCancel,
}: PageTypePositionsViewProps) {
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<PositionMode>("list");
  const [activePlugin, setActivePlugin] = useState<string | null>(null);

  const entries = useMemo<PositionEntry[]>(() => {
    const list: PositionEntry[] = [];
    for (const [key, value] of Object.entries(positions)) {
      if (typeof value === "string") {
        list.push({ kind: "plugin", pluginName: key, position: value });
      } else if (Array.isArray(value)) {
        list.push({ kind: "clear", zone: key, count: value.length });
      }
    }
    return list;
  }, [positions]);

  const pluginOverrides = entries.filter(
    (entry) => entry.kind === "plugin",
  ) as Array<Extract<PositionEntry, { kind: "plugin" }>>;

  const existingOverrideNames = new Set(
    pluginOverrides.map((entry) => entry.pluginName),
  );
  const availablePlugins = enabledPlugins.filter(
    (plugin) => !existingOverrideNames.has(plugin.name),
  );

  const commitPosition = useCallback(
    (pluginName: string, position: string) => {
      const nextPositions = { ...positions, [pluginName]: position };
      onUpdate(nextPositions);
    },
    [positions, onUpdate],
  );

  useKeyboard((event) => {
    if (mode !== "list") return;

    if (event.name === "escape") {
      onCancel();
      return;
    }
    if (event.name === "n") {
      setMode("add-plugin");
    }
    if (event.name === "d") {
      const entry = entries[selected];
      if (!entry) return;
      const nextPositions = { ...positions };
      if (entry.kind === "plugin") {
        delete nextPositions[entry.pluginName];
      } else {
        delete nextPositions[entry.zone];
      }
      onUpdate(nextPositions);
      setSelected((i) => Math.max(0, i - 1));
    }
  });

  useKeyboard((event) => {
    if (mode !== "add-plugin") return;
    if (event.name === "escape") setMode("list");
  });

  useKeyboard((event) => {
    if (mode !== "select-position") return;
    if (event.name === "escape") setMode("list");
  });

  if (mode === "add-plugin") {
    const options: SelectOption[] = availablePlugins.map((plugin) => ({
      name: plugin.displayName,
      description: plugin.name,
      value: plugin.name,
    }));

    return (
      <box flexDirection="column" padding={1}>
        <text>
          <strong>Select plugin to override:</strong>
        </text>
        {availablePlugins.length === 0 ? (
          <text>
            <span fg="#888888">No available plugins to override</span>
          </text>
        ) : (
          <select
            options={options}
            focused
            onSelect={(_index: number, option: SelectOption | null) => {
              const pluginName = option?.value as string | undefined;
              if (!pluginName) return;
              setActivePlugin(pluginName);
              setMode("select-position");
            }}
            showDescription
            showScrollIndicator
          />
        )}
        <box marginTop={1}>
          <text>
            <span fg="#888888">Enter: select │ Esc: back</span>
          </text>
        </box>
      </box>
    );
  }

  if (mode === "select-position" && activePlugin) {
    const options: SelectOption[] = ZONES.map((zone) => ({
      name: zone,
      description: "",
      value: zone,
    }));

    return (
      <box flexDirection="column" padding={1}>
        <text>
          <strong>Select position for "{activePlugin}":</strong>
        </text>
        <select
          options={options}
          focused
          onSelect={(_index: number, option: SelectOption | null) => {
            const zone = option?.value as Zone | undefined;
            if (!zone) return;
            commitPosition(activePlugin, zone);
            setMode("list");
          }}
          showDescription={false}
          showScrollIndicator={false}
        />
        <box marginTop={1}>
          <text>
            <span fg="#888888">Enter: select │ Esc: back</span>
          </text>
        </box>
      </box>
    );
  }

  const listOptions: SelectOption[] = entries.map((entry) => {
    if (entry.kind === "plugin") {
      return {
        name: entry.pluginName,
        description: `→ ${entry.position}`,
        value: entry.pluginName,
      };
    }
    const label = entry.count === 0 ? "(cleared)" : `(custom ${entry.count})`;
    return {
      name: entry.zone,
      description: label,
      value: entry.zone,
    };
  });

  return (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>Position overrides for "{pageType}":</strong>
      </text>
      {entries.length === 0 ? (
        <text>
          <span fg="#888888">No position overrides</span>
        </text>
      ) : (
        <select
          options={listOptions}
          focused
          onChange={(index: number) => setSelected(Math.max(0, index))}
          onSelect={() => {
            const entry = entries[selected];
            if (!entry || entry.kind !== "plugin") return;
            setActivePlugin(entry.pluginName);
            setMode("select-position");
          }}
          showDescription
          showScrollIndicator
        />
      )}
      <box marginTop={1}>
        <text>
          <span fg="#888888">Enter: edit │ n: new │ d: delete │ Esc: back</span>
        </text>
      </box>
    </box>
  );
}
