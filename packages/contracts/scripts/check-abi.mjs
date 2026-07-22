import { readFile } from "node:fs/promises";
import { buildGeneratedBindings, outputPath } from "./abi-bindings.mjs";

const expected = await buildGeneratedBindings();
const actual = await readFile(outputPath, "utf8").catch(() => "");
if (actual !== expected) {
  console.error("Generated contract bindings are stale. Run `pnpm contracts:generate-abi`.");
  process.exit(1);
}
console.log("Generated contract bindings match Foundry artifacts and Solidity enums.");
