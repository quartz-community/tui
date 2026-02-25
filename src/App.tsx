import { useCallback, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import {
  createRoot,
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import {
  Notification,
  type NotificationMessage,
} from "./components/Notification.js";
import { SetupWizard } from "./components/SetupWizard.js";
import { StatusBar } from "./components/StatusBar.js";
import { LayoutPanel } from "./panels/LayoutPanel.js";
import { PluginsPanel } from "./panels/PluginsPanel.js";
import { SettingsPanel } from "./panels/SettingsPanel.js";
import { getQuartzVersion, configExists } from "./lib/config.js";

const version = getQuartzVersion();
const TABS = ["Plugins", "Layout", "Settings"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const renderer = useRenderer();
  const { height: rows } = useTerminalDimensions();
  const [hasConfig, setHasConfig] = useState(() => configExists());
  const [activeTab, setActiveTab] = useState<Tab>("Plugins");
  const [notification, setNotification] = useState<NotificationMessage | null>(
    null,
  );
  const [panelFocused, setPanelFocused] = useState(false);

  const notify = useCallback(
    (message: string, type: "success" | "error" | "info" = "info") => {
      setNotification({ message, type });
      setTimeout(() => setNotification(null), 3000);
    },
    [],
  );

  useKeyboard((event) => {
    if (panelFocused || !hasConfig) return;
    if (event.name !== "q") return;
    renderer.destroy();
    process.exit(0);
  });

  useKeyboard((event) => {
    if (!hasConfig || panelFocused) return;
    if (event.name !== "tab") return;

    const currentIndex = TABS.indexOf(activeTab);
    const next = event.shift
      ? (currentIndex - 1 + TABS.length) % TABS.length
      : (currentIndex + 1) % TABS.length;
    setActiveTab(TABS[next]);
  });

  if (!hasConfig) {
    return (
      <box flexDirection="column" height={rows}>
        <box justifyContent="center" paddingY={0}>
          <text>
            <span fg="green">
              <strong>{` Quartz v${version} Plugin Manager `}</strong>
            </span>
          </text>
        </box>

        <box flexDirection="column" flexGrow={1} justifyContent="center">
          <SetupWizard
            onComplete={() => {
              setHasConfig(true);
              notify("Configuration created", "success");
            }}
          />
        </box>

        {notification && <Notification message={notification} />}
      </box>
    );
  }

  return (
    <box flexDirection="column" height={rows}>
      <box justifyContent="center" paddingY={0}>
        <text>
          <span fg="green">
            <strong>{` Quartz v${version} Plugin Manager `}</strong>
          </span>
        </text>
      </box>

      <box flexDirection="row" paddingX={1} gap={2}>
        {TABS.map((tab) => (
          <text key={tab}>
            {tab === activeTab ? (
              <span fg="cyan">
                <strong>[ {tab} ]</strong>
              </span>
            ) : (
              <span fg="#888888">{`  ${tab}  `}</span>
            )}
          </text>
        ))}
      </box>

      <box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        {activeTab === "Plugins" && (
          <PluginsPanel notify={notify} onFocusChange={setPanelFocused} />
        )}
        {activeTab === "Layout" && (
          <LayoutPanel notify={notify} onFocusChange={setPanelFocused} />
        )}
        {activeTab === "Settings" && (
          <SettingsPanel notify={notify} onFocusChange={setPanelFocused} />
        )}
      </box>

      {notification && <Notification message={notification} />}

      <StatusBar activeTab={activeTab} />
    </box>
  );
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<App />);
