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

function runQuartzPlugin(
  args: string[],
  onProgress?: ProgressCallback,
): Promise<OperationResult> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["quartz", "plugin", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
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
