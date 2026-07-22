import { writeFile } from "node:fs/promises";
import { buildGeneratedBindings, outputPath } from "./abi-bindings.mjs";

await writeFile(outputPath, await buildGeneratedBindings(), "utf8");
console.log(`Generated ${outputPath}`);
