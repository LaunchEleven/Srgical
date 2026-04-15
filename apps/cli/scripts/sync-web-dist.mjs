#!/usr/bin/env node

import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const cliRoot = path.resolve(import.meta.dirname, "..");
const webDist = path.resolve(cliRoot, "..", "studio-web", "dist");
const target = path.join(cliRoot, "dist", "studio-web");

await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });

try {
  await cp(webDist, target, { recursive: true });
} catch {
  // The CLI can still run in terminal mode before the web bundle exists.
}
