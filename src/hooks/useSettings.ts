import { useState, useCallback } from "react";
import { getGlobalConfig, updateGlobalConfig } from "../lib/config.js";

export function useSettings() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(() =>
    getGlobalConfig(),
  );

  const refresh = useCallback(() => {
    setConfig(getGlobalConfig());
  }, []);

  const updateField = useCallback(
    (key: string, value: unknown) => {
      updateGlobalConfig({ [key]: value });
      refresh();
    },
    [refresh],
  );

  return { config, refresh, updateField };
}
