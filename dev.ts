import type { SpawnOptions } from "bun";

const spawnOptions: SpawnOptions.OptionsObject<any, any, any> = {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
};

const run = async () => {
  Bun.spawn(["bun", "run", "dev:server"], spawnOptions);
  Bun.spawn(["bun", "run", "dev:css"], spawnOptions);

  process.on("SIGINT", async () => {
    console.log("Cleaning up...");
  });
};

run();
