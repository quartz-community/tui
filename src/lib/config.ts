import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import YAML from "yaml";

// Path constants — all relative to process.cwd() since TUI runs in Quartz project context
const LOCKFILE_PATH = path.join(process.cwd(), "quartz.lock.json");
const PLUGINS_DIR = path.join(process.cwd(), ".quartz", "plugins");
const CONFIG_YAML_PATH = path.join(process.cwd(), "quartz.config.yaml");
const DEFAULT_CONFIG_YAML_PATH = path.join(
  process.cwd(),
  "quartz.config.default.yaml",
);

const LEGACY_PLUGINS_JSON_PATH = path.join(
  process.cwd(),
  "quartz.plugins.json",
);
const LEGACY_DEFAULT_PLUGINS_JSON_PATH = path.join(
  process.cwd(),
  "quartz.plugins.default.json",
);

function resolveConfigPath(): string {
  if (fs.existsSync(CONFIG_YAML_PATH)) return CONFIG_YAML_PATH;
  if (fs.existsSync(LEGACY_PLUGINS_JSON_PATH)) return LEGACY_PLUGINS_JSON_PATH;
  return CONFIG_YAML_PATH;
}

function resolveDefaultConfigPath(): string {
  if (fs.existsSync(DEFAULT_CONFIG_YAML_PATH)) return DEFAULT_CONFIG_YAML_PATH;
  if (fs.existsSync(LEGACY_DEFAULT_PLUGINS_JSON_PATH))
    return LEGACY_DEFAULT_PLUGINS_JSON_PATH;
  return DEFAULT_CONFIG_YAML_PATH;
}

function readFileAsData(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
      return YAML.parse(raw) as Record<string, unknown>;
    }
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeDataToFile(
  filePath: string,
  data: Record<string, unknown>,
): void {
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    const header =
      "# yaml-language-server: $schema=./quartz/plugins/quartz-plugins.schema.json\n";
    fs.writeFileSync(
      filePath,
      header + YAML.stringify(data, { lineWidth: 120 }),
    );
  } else {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  }
}

export function readPluginsJson(): Record<string, unknown> | null {
  const configPath = resolveConfigPath();
  return readFileAsData(configPath);
}

export function writePluginsJson(data: Record<string, unknown>): void {
  const { $schema, ...rest } = data;
  writeDataToFile(CONFIG_YAML_PATH, rest);
}

export function readDefaultPluginsJson(): Record<string, unknown> | null {
  const defaultPath = resolveDefaultConfigPath();
  return readFileAsData(defaultPath);
}

export function readLockfile(): Record<string, unknown> | null {
  if (!fs.existsSync(LOCKFILE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(LOCKFILE_PATH, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function writeLockfile(lockfile: Record<string, unknown>): void {
  const plugins = lockfile.plugins as Record<string, unknown> | undefined;
  if (plugins) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(plugins).sort()) {
      sorted[key] = plugins[key];
    }
    lockfile = { ...lockfile, plugins: sorted };
  }
  fs.writeFileSync(LOCKFILE_PATH, JSON.stringify(lockfile, null, 2) + "\n");
}

export function extractPluginName(source: string): string {
  if (source.startsWith("github:")) {
    const withoutPrefix = source.replace("github:", "");
    const [repoPath] = withoutPrefix.split("#");
    const parts = repoPath.split("/");
    return parts[parts.length - 1];
  }
  if (source.startsWith("git+") || source.startsWith("https://")) {
    const url = source.replace("git+", "");
    const match = url.match(/\/([^/]+?)(?:\.git)?(?:#|$)/);
    return match?.[1] ?? source;
  }
  return source;
}

export function readManifestFromPackageJson(
  pluginDir: string,
): Record<string, unknown> | null {
  const pkgPath = path.join(pluginDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<
      string,
      unknown
    >;
    return (pkg.quartz as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

export function parseGitSource(source: string): {
  name: string;
  url: string;
  ref?: string;
} {
  if (source.startsWith("github:")) {
    const [repoPath, ref] = source.replace("github:", "").split("#");
    const [owner, repo] = repoPath.split("/");
    return { name: repo, url: `https://github.com/${owner}/${repo}.git`, ref };
  }
  if (source.startsWith("git+")) {
    const url = source.replace("git+", "");
    const name = path.basename(url, ".git");
    return { name, url };
  }
  if (source.startsWith("https://")) {
    const name = path.basename(source, ".git");
    return { name, url: source };
  }
  throw new Error(`Cannot parse plugin source: ${source}`);
}

export function getGitCommit(pluginDir: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: pluginDir,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

export function getPluginDir(name: string): string {
  return path.join(PLUGINS_DIR, name);
}

export function pluginDirExists(name: string): boolean {
  return fs.existsSync(path.join(PLUGINS_DIR, name));
}

export function ensurePluginsDir(): void {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }
}

export function getEnrichedPlugins(): Array<{
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
}> {
  const pluginsJson = readPluginsJson();
  const lockfile = readLockfile();

  const plugins = pluginsJson?.plugins as
    | Array<Record<string, unknown>>
    | undefined;
  if (!plugins) return [];

  return plugins.map((entry, index) => {
    const source = entry.source as string;
    const name = extractPluginName(source);
    const pluginDir = path.join(PLUGINS_DIR, name);
    const installed = fs.existsSync(pluginDir);
    const lockedPlugins = lockfile?.plugins as
      | Record<string, Record<string, unknown>>
      | undefined;
    const locked =
      (lockedPlugins?.[name] as
        | {
            source: string;
            resolved: string;
            commit: string;
            installedAt: string;
          }
        | undefined) ?? null;
    const manifest = installed ? readManifestFromPackageJson(pluginDir) : null;
    const currentCommit = installed ? getGitCommit(pluginDir) : null;
    const modified =
      locked && currentCommit ? currentCommit !== locked.commit : false;

    return {
      index,
      name,
      displayName: (manifest?.displayName as string) ?? name,
      source,
      enabled: (entry.enabled as boolean) ?? true,
      options: (entry.options as Record<string, unknown>) ?? {},
      order: (entry.order as number) ?? 50,
      layout:
        (entry.layout as
          | {
              position: string;
              priority: number;
              display: string;
              condition?: string;
              group?: string;
              groupOptions?: Record<string, unknown>;
            }
          | undefined) ?? null,
      category: (manifest?.category as string | string[]) ?? "unknown",
      installed,
      locked,
      manifest,
      currentCommit,
      modified,
    };
  });
}

export function getLayoutConfig(): Record<string, unknown> | null {
  const pluginsJson = readPluginsJson();
  return (pluginsJson?.layout as Record<string, unknown>) ?? null;
}

export function getGlobalConfig(): Record<string, unknown> | null {
  const pluginsJson = readPluginsJson();
  return (pluginsJson?.configuration as Record<string, unknown>) ?? null;
}

export function updatePluginEntry(
  index: number,
  updates: Record<string, unknown>,
): boolean {
  const json = readPluginsJson();
  const plugins = json?.plugins as Array<Record<string, unknown>> | undefined;
  if (!plugins?.[index]) return false;
  Object.assign(plugins[index], updates);
  writePluginsJson(json!);
  return true;
}

export function updateGlobalConfig(updates: Record<string, unknown>): boolean {
  const json = readPluginsJson();
  if (!json) return false;
  json.configuration = {
    ...(json.configuration as Record<string, unknown>),
    ...updates,
  };
  writePluginsJson(json);
  return true;
}

export function updateLayoutConfig(layout: Record<string, unknown>): boolean {
  const json = readPluginsJson();
  if (!json) return false;
  json.layout = layout;
  writePluginsJson(json);
  return true;
}

export function reorderPlugin(fromIndex: number, toIndex: number): boolean {
  const json = readPluginsJson();
  const plugins = json?.plugins as Array<Record<string, unknown>> | undefined;
  if (!plugins) return false;
  const [moved] = plugins.splice(fromIndex, 1);
  plugins.splice(toIndex, 0, moved);
  writePluginsJson(json!);
  return true;
}

export function removePluginEntry(index: number): boolean {
  const json = readPluginsJson();
  const plugins = json?.plugins as Array<Record<string, unknown>> | undefined;
  if (!plugins?.[index]) return false;
  plugins.splice(index, 1);
  writePluginsJson(json!);
  return true;
}

export function addPluginEntry(entry: Record<string, unknown>): boolean {
  const json = readPluginsJson();
  if (!json) return false;
  if (!json.plugins) json.plugins = [];
  (json.plugins as Array<Record<string, unknown>>).push(entry);
  writePluginsJson(json);
  return true;
}

export function configExists(): boolean {
  return (
    fs.existsSync(CONFIG_YAML_PATH) || fs.existsSync(LEGACY_PLUGINS_JSON_PATH)
  );
}

export function createConfigFromDefault(): Record<string, unknown> {
  const defaultData = readDefaultPluginsJson();
  if (!defaultData) {
    const minimal: Record<string, unknown> = {
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
    };
    writePluginsJson(minimal);
    return minimal;
  }

  const { $schema, ...rest } = defaultData;
  writePluginsJson(rest);
  return rest;
}

/** Read the Quartz version from the host project's package.json */
export function getQuartzVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<
      string,
      unknown
    >;
    return (pkg.version as string) ?? "unknown";
  } catch {
    return "unknown";
  }
}

// Re-export path constants for compatibility
export { LOCKFILE_PATH, PLUGINS_DIR };
export const PLUGINS_JSON_PATH = CONFIG_YAML_PATH;
export const DEFAULT_PLUGINS_JSON_PATH = DEFAULT_CONFIG_YAML_PATH;
