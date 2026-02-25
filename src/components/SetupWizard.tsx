import { type SelectOption } from "@opentui/core";
import {
  createConfigFromDefault,
  readDefaultPluginsJson,
  writePluginsJson,
} from "../lib/config.js";

interface SetupWizardProps {
  onComplete: () => void;
}

type Choice = "default" | "empty";

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const hasDefault = readDefaultPluginsJson() !== null;
  const choices: { key: Choice; label: string; description: string }[] = [
    ...(hasDefault
      ? [
          {
            key: "default" as Choice,
            label: "Use default configuration",
            description:
              "Copy quartz.config.default.yaml as your starting config",
          },
        ]
      : []),
    {
      key: "empty",
      label: "Start with empty configuration",
      description: "Create a minimal config with no plugins",
    },
  ];

  const selectOptions: SelectOption[] = choices.map((choice) => ({
    name: choice.label,
    description: choice.description,
    value: choice.key,
  }));

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      <box flexDirection="column" marginBottom={1}>
        <text>
          <span fg="yellow">
            <strong>No configuration found</strong>
          </span>
        </text>
        <text>
          <span fg="#888888">
            quartz.config.yaml does not exist yet. How would you like to set up
            your configuration?
          </span>
        </text>
      </box>

      <select
        options={selectOptions}
        focused
        onSelect={(_index: number, option: SelectOption | null) => {
          if (!option) return;
          const choice = option.value as Choice;
          if (choice === "default") {
            createConfigFromDefault();
          } else {
            writePluginsJson({
              $schema: "./quartz/plugins/quartz-plugins.schema.json",
              configuration: {
                pageTitle: "Quartz",
                enableSPA: true,
                enablePopovers: true,
                analytics: { provider: "plausible" },
                locale: "en-US",
                baseUrl: "quartz.jzhao.xyz",
                ignorePatterns: ["private", "templates", ".obsidian"],
                defaultDateType: "created",
                theme: {
                  cdnCaching: true,
                  typography: {
                    header: "Schibsted Grotesk",
                    body: "Source Sans Pro",
                    code: "IBM Plex Mono",
                  },
                  colors: {
                    lightMode: {
                      light: "#faf8f8",
                      lightgray: "#e5e5e5",
                      gray: "#b8b8b8",
                      darkgray: "#4e4e4e",
                      dark: "#2b2b2b",
                      secondary: "#284b63",
                      tertiary: "#84a59d",
                      highlight: "rgba(143, 159, 169, 0.15)",
                      textHighlight: "#fff23688",
                    },
                    darkMode: {
                      light: "#161618",
                      lightgray: "#393639",
                      gray: "#646464",
                      darkgray: "#d4d4d4",
                      dark: "#ebebec",
                      secondary: "#7b97aa",
                      tertiary: "#84a59d",
                      highlight: "rgba(143, 159, 169, 0.15)",
                      textHighlight: "#fff23688",
                    },
                  },
                },
              },
              plugins: [],
              layout: { groups: {}, byPageType: {} },
            });
          }
          onComplete();
        }}
      />
    </box>
  );
}
