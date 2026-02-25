import { useState, useCallback } from "react";
import {
  getEnrichedPlugins,
  updatePluginEntry,
  addPluginEntry,
  removePluginEntry,
  reorderPlugin,
} from "../lib/config.js";

export interface EnrichedPlugin {
  index: number;
  name: string;
  displayName: string;
  source: string;
  enabled: boolean;
  options: Record<string, unknown>;
  order: number;
  layout: {
    position: string;
    priority: number;
    display: string;
    condition?: string;
    group?: string;
    groupOptions?: Record<string, unknown>;
  } | null;
  category: string | string[];
  installed: boolean;
  locked: {
    source: string;
    resolved: string;
    commit: string;
    installedAt: string;
  } | null;
  manifest: Record<string, unknown> | null;
  currentCommit: string | null;
  modified: boolean;
}

export function usePlugins() {
  const [plugins, setPlugins] = useState<EnrichedPlugin[]>(() =>
    getEnrichedPlugins(),
  );

  const refresh = useCallback(() => {
    setPlugins(getEnrichedPlugins());
  }, []);

  const toggleEnabled = useCallback(
    (index: number) => {
      const plugin = plugins[index];
      if (!plugin) return;
      updatePluginEntry(plugin.index, { enabled: !plugin.enabled });
      refresh();
    },
    [plugins, refresh],
  );

  const setPluginOrder = useCallback(
    (index: number, order: number) => {
      const plugin = plugins[index];
      if (!plugin) return;
      updatePluginEntry(plugin.index, { order });
      refresh();
    },
    [plugins, refresh],
  );

  const setPluginOptions = useCallback(
    (index: number, key: string, value: unknown) => {
      const plugin = plugins[index];
      if (!plugin) return;
      const newOptions = { ...plugin.options, [key]: value };
      updatePluginEntry(plugin.index, { options: newOptions });
      refresh();
    },
    [plugins, refresh],
  );

  const removePlugin = useCallback(
    (index: number) => {
      const plugin = plugins[index];
      if (!plugin) return false;
      const result = removePluginEntry(plugin.index);
      if (result) refresh();
      return result;
    },
    [plugins, refresh],
  );

  const addPlugin = useCallback(
    (source: string) => {
      const entry = {
        source,
        enabled: true,
        options: {},
        order: 50,
      };
      const result = addPluginEntry(entry);
      if (result) refresh();
      return result;
    },
    [refresh],
  );

  const movePlugin = useCallback(
    (fromIndex: number, toIndex: number) => {
      const result = reorderPlugin(fromIndex, toIndex);
      if (result) refresh();
      return result;
    },
    [refresh],
  );

  const updateLayout = useCallback(
    (index: number, layout: EnrichedPlugin["layout"]) => {
      const plugin = plugins[index];
      if (!plugin) return;
      updatePluginEntry(plugin.index, { layout });
      refresh();
    },
    [plugins, refresh],
  );

  return {
    plugins,
    refresh,
    toggleEnabled,
    setPluginOrder,
    setPluginOptions,
    removePlugin,
    addPlugin,
    movePlugin,
    updateLayout,
  };
}
