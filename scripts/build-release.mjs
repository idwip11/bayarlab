import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(root, "dist"), { recursive: true });
await build({
  entryPoints: [resolve(root, "apps/cli/dist/index.js")],
  outfile: resolve(root, "dist/index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22.13",
  external: ["commander", "fastify", "yaml", "zod"],
  legalComments: "inline",
});
// The bundled dashboard resolves assets relative to its own import.meta.url.
await rm(resolve(root, "dist/client"), { recursive: true, force: true });
await cp(resolve(root, "apps/web/dist/client"), resolve(root, "dist/client"), {
  recursive: true,
  force: true,
});
// Retain license/copyright notices for libraries bundled into the browser client.
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const reactDomRequire = createRequire(webRequire.resolve("react-dom/package.json"));
await rm(resolve(root, "dist/licenses"), { recursive: true, force: true });
await mkdir(resolve(root, "dist/licenses"), { recursive: true });
for (const name of ["react", "react-dom", "scheduler"]) {
  const requirePackage = name === "scheduler" ? reactDomRequire : webRequire;
  await cp(
    resolve(dirname(requirePackage.resolve(`${name}/package.json`)), "LICENSE"),
    resolve(root, `dist/licenses/${name}.txt`),
  );
}
process.stdout.write("Release bundle built: bayarlab CLI and dashboard assets.\n");
