import { useState, useCallback } from "react";
import { getLayoutConfig, updateLayoutConfig } from "../lib/config.js";

export interface LayoutZone {
  position: string;
  components: Array<{
    pluginName: string;
    displayName: string;
    priority: number;
    display: string;
    condition?: string;
    group?: string;
  }>;
}

export function useLayout() {
  const [layout, setLayout] = useState<Record<string, unknown> | null>(() =>
    getLayoutConfig(),
  );

  const refresh = useCallback(() => {
    setLayout(getLayoutConfig());
  }, []);

  const save = useCallback(
    (newLayout: Record<string, unknown>) => {
      updateLayoutConfig(newLayout);
      refresh();
    },
    [refresh],
  );

  return { layout, refresh, save };
}
