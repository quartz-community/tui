import test from "node:test";
import assert from "node:assert/strict";
import { npxCommand } from "../src/lib/cli-bridge.ts";

test("npx runs without a shell outside Windows", () => {
  const args = ["quartz", "plugin", "add", "github:quartz-community/explorer; rm -rf ~"];
  assert.deepEqual(npxCommand(args, "linux"), { file: "npx", args, shell: false });
  assert.deepEqual(npxCommand(args, "darwin"), { file: "npx", args, shell: false });
});

// On Windows npx is npx.cmd, which Node only runs through a shell (CVE-2024-27980).
test("npx is npx.cmd through the shell on Windows, every argument quoted", () => {
  assert.deepEqual(
    npxCommand(["quartz", "plugin", "add", "github:quartz-community/explorer#v1.0.0"], "win32"),
    {
      file: "npx.cmd",
      args: ['"quartz"', '"plugin"', '"add"', '"github:quartz-community/explorer#v1.0.0"'],
      shell: true,
    },
  );
  assert.deepEqual(npxCommand(["C:/sites/my plugin"], "win32").args, ['"C:/sites/my plugin"']);
});

test("an argument cmd.exe would interpret is refused on Windows", () => {
  for (const arg of ['a"&calc', "%PATH%", "!x!", "a\\"]) {
    assert.throws(() => npxCommand(["quartz", arg], "win32"), /Refusing to pass/);
  }
});
