import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
for (const dir of ["src", "scripts", "test"])
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const result = spawnSync(process.execPath, ["--check", `${dir}/${file}`], {
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(1);
  }
console.log("All JavaScript files parse successfully.");
