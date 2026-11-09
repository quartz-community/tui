import { spawn } from "child_process";

export type ProgressCallback = (
  message: string,
  type: "info" | "success" | "error" | "warning",
) => void;

export interface OperationResult {
  success: boolean;
  installed?: number;
  failed?: number;
  updated?: string[];
  errors?: string[];
}

// Characters allowed in an argument that must go through cmd.exe on Windows (as Quartz's own
// npmCommand, quartz/cli/subprocess.js, plus `#` for `github:user/repo#ref`). Each argument is wrapped in double quotes, inside which
// spaces and < > | are literal; `"`, `%` and `!` (which cmd.exe still interprets there) are never
// allowed.
const WINDOWS_SHELL_SAFE = /^[A-Za-z0-9@._/:=+~^,<>|*# -]+$/;

/**
 * How to run `npx <args>`. On Windows npx is `npx.cmd`, which Node only runs through a shell
 * (CVE-2024-27980): spawning "npx" without one fails with ENOENT, and "npx.cmd" without one with
 * EINVAL. There every argument must pass a strict whitelist and is quoted. Elsewhere the
 * arguments go to npx as an array, never through a shell.
 */
export function npxCommand(
  args: string[],
  platform: string = process.platform,
): { file: string; args: string[]; shell: boolean } {
  if (platform !== "win32") return { file: "npx", args, shell: false };
  const quoted = args.map((arg) => {
    if (!WINDOWS_SHELL_SAFE.test(arg)) {
      throw new Error(
        `Refusing to pass ${JSON.stringify(arg)} to npx through the Windows shell`,
      );
    }
    return `"${arg}"`;
  });
  return { file: "npx.cmd", args: quoted, shell: true };
}

function runQuartzPlugin(
  args: string[],
  onProgress?: ProgressCallback,
): Promise<OperationResult> {
  return new Promise((resolve) => {
    let cmd: ReturnType<typeof npxCommand>;
    try {
      cmd = npxCommand(["quartz", "plugin", ...args]);
    } catch (err) {
      resolve({ success: false, errors: [(err as Error).message] });
      return;
    }
    const child = spawn(cmd.file, cmd.args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: cmd.shell,
    });

    const errors: string[] = [];
    let stdout = "";

    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        stdout += line + "\n";
        const type = classifyLine(line);
        onProgress?.(line, type);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        errors.push(line);
        onProgress?.(line, "error");
      }
    });

    child.on("error", (err: Error) => {
      errors.push(err.message);
      resolve({ success: false, errors });
    });

    child.on("close", (code: number | null) => {
      const result = parseOutput(stdout, code === 0);
      if (errors.length > 0) {
        result.errors = [...(result.errors ?? []), ...errors];
      }
      resolve(result);
    });
  });
}

function classifyLine(line: string): "info" | "success" | "error" | "warning" {
  if (line.includes("✓") || line.includes("success")) return "success";
  if (line.includes("✗") || line.includes("error") || line.includes("Error"))
    return "error";
  if (line.includes("⚠") || line.includes("warning")) return "warning";
  return "info";
}

function parseOutput(stdout: string, exitSuccess: boolean): OperationResult {
  const lines = stdout.split("\n").filter(Boolean);
  const errors: string[] = [];
  const updated: string[] = [];
  let installed = 0;
  let failed = 0;

  for (const line of lines) {
    if (line.includes("✗")) {
      failed++;
      errors.push(line.trim());
    }
    if (
      line.includes("✓") &&
      (line.includes("installed") ||
        line.includes("Added") ||
        line.includes("built") ||
        line.includes("Restored") ||
        line.includes("cloned"))
    ) {
      installed++;
    }
    if (line.includes("Updated") && line.includes("✓")) {
      const match = line.match(/Updated\s+(\S+)/);
      if (match) updated.push(match[1]);
    }
  }

  const summaryMatch = stdout.match(/(?:Installed|Restored)\s+(\d+)\s+plugin/);
  if (summaryMatch) {
    installed = parseInt(summaryMatch[1], 10);
  }
  const failMatch = stdout.match(/(\d+)\s+failed/);
  if (failMatch) {
    failed = parseInt(failMatch[1], 10);
  }

  return {
    success: exitSuccess && failed === 0,
    installed: installed || undefined,
    failed: failed || undefined,
    updated: updated.length > 0 ? updated : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function tuiPluginInstall(
  onProgress?: ProgressCallback,
): Promise<OperationResult> {
  return runQuartzPlugin(["install"], onProgress);
}

export async function tuiPluginAdd(
  sources: string[],
  onProgress?: ProgressCallback,
): Promise<OperationResult> {
  return runQuartzPlugin(["add", ...sources], onProgress);
}

export async function tuiPluginRemove(
  names: string[],
  onProgress?: ProgressCallback,
): Promise<OperationResult> {
  return runQuartzPlugin(["remove", ...names], onProgress);
}

export async function tuiPluginUpdate(
  names?: string[],
  onProgress?: ProgressCallback,
): Promise<OperationResult> {
  const args = ["update"];
  if (names && names.length > 0) {
    args.push(...names);
  }
  return runQuartzPlugin(args, onProgress);
}

export async function tuiPluginRestore(
  onProgress?: ProgressCallback,
): Promise<OperationResult> {
  return runQuartzPlugin(["restore"], onProgress);
}
