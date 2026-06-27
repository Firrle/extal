const { spawnSync } = require("child_process");
const path = require("path");

delete process.env.ELECTRON_RUN_AS_NODE;

const electronPath = require("electron");
const appPath = path.resolve(__dirname, "..");
const result = spawnSync(electronPath, [appPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});

process.exit(result.status == null ? 1 : result.status);
