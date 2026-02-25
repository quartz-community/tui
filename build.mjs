#!/usr/bin/env node
import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(__dirname, "src", "App.tsx")],
  outdir: path.join(__dirname, "dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "@opentui/react",
  packages: "external",
  sourcemap: true,
  target: "esnext",
  outExtension: { ".js": ".mjs" },
});
