import * as fs from "node:fs";

import type { Config } from "./config";
import { generate } from "./exports";

function recursivelyInterpolateEnvVars(thing: unknown): any {
  // string? => do the interpolation
  if (typeof thing === "string") {
    return thing.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_0, name) => {
      const e = process.env[name];
      if (e === undefined) {
        throw new Error(`Environment variable '${name}' is not set`);
      }
      return e;
    });
  }

  // array? => recurse over its items
  if (Array.isArray(thing)) {
    return thing.map((item) => recursivelyInterpolateEnvVars(item));
  }

  // object? => recurse over its values (but don't touch the keys)
  if (thing !== null && typeof thing === "object") {
    return (Object.keys(thing) as Array<keyof typeof thing>).reduce<any>((memo, key) => {
      Object.assign(memo, { [key]: recursivelyInterpolateEnvVars(thing[key]) });
      return memo;
    }, {});
  }

  // anything else (e.g. number)? => pass right through
  return thing;
}

async function main() {
  const configFile = "brand-map-postgres.config.json";
  const configJson = fs.existsSync(configFile) ? fs.readFileSync(configFile, { encoding: "utf8" }) : "{}";
  const argsJson = process.argv[2] ?? "{}";

  let fileConfig;
  try {
    fileConfig = recursivelyInterpolateEnvVars(JSON.parse(configJson));
  } catch (err: any) {
    throw new Error(`If present, brand-map-postgres.config.json must be a valid JSON file, and all referenced environment variables must exist: ${err.message}`);
  }

  let argsConfig;
  try {
    argsConfig = recursivelyInterpolateEnvVars(JSON.parse(argsJson));
  } catch (err: any) {
    throw new Error(`If present, the argument to Postgres must be valid JSON, and all referenced environment variables must exist: ${err.message}`);
  }

  await generate({ ...fileConfig, ...argsConfig } as Config);
}

void (await main());
