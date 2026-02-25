const KEYBINDS: Record<string, string[]> = {
  Plugins: [
    "↑↓ navigate",
    "e enable",
    "d disable",
    "a add",
    "r remove",
    "i install",
    "u update",
    "o options",
    "s sort",
    "Tab switch tab",
    "q quit",
  ],
  Layout: [
    "↑↓ navigate",
    "←→ move zone",
    "K/J reorder",
    "m move",
    "p priority",
    "v display",
    "c condition",
    "x remove",
    "g groups",
    "t page-types",
    "Tab switch tab",
    "q quit",
  ],
  Settings: ["↑↓ navigate", "Enter edit", "Tab switch tab", "q quit"],
};

interface StatusBarProps {
  activeTab: string;
}

export function StatusBar({ activeTab }: StatusBarProps) {
  const hints = KEYBINDS[activeTab] ?? [];

  return (
    <box border borderStyle="single" paddingX={1}>
      <text>
        <span fg="#888888">{hints.join(" │ ")}</span>
      </text>
    </box>
  );
}
