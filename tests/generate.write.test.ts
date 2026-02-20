import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { generate } from "../src/generate/write";

const createdDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-map-postgres-generate-test-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("generate/write", () => {
  test("writes schema file and skips custom folder when no custom types are returned", async () => {
    const outDir = makeTempDir();

    await generate(
      { outDir, progressListener: false, warningListener: false },
      {
        tsForConfig: async () => ({
          ts: "export type Marker = 'schema';\n",
          customTypeSourceFiles: {},
        }),
      },
    );

    const schemaPath = path.join(outDir, "brand-map-postgres.schema.d.ts");
    const customDir = path.join(outDir, "custom");

    expect(fs.existsSync(schemaPath)).toBe(true);
    expect(fs.readFileSync(schemaPath, "utf8")).toBe("export type Marker = 'schema';\n");
    expect(fs.existsSync(customDir)).toBe(false);
  });

  test("writes custom type files and custom index file", async () => {
    const outDir = makeTempDir();

    await generate(
      { outDir, progressListener: false, warningListener: false },
      {
        tsForConfig: async () => ({
          ts: "export type Schema = true;\n",
          customTypeSourceFiles: {
            PgCustomA: "export type PgCustomA = string;\n",
            PgCustomB: "export type PgCustomB = number;\n",
          },
        }),
      },
    );

    const schemaPath = path.join(outDir, "brand-map-postgres.schema.d.ts");
    const customDir = path.join(outDir, "custom");
    const customAPath = path.join(customDir, "PgCustomA.d.ts");
    const customBPath = path.join(customDir, "PgCustomB.d.ts");
    const customIndexPath = path.join(customDir, "index.d.ts");
    const customIndexContent = fs.readFileSync(customIndexPath, "utf8");

    expect(fs.existsSync(schemaPath)).toBe(true);
    expect(fs.existsSync(customAPath)).toBe(true);
    expect(fs.existsSync(customBPath)).toBe(true);
    expect(fs.readFileSync(customAPath, "utf8")).toBe("export type PgCustomA = string;\n");
    expect(fs.readFileSync(customBPath, "utf8")).toBe("export type PgCustomB = number;\n");
    expect(customIndexContent).toContain("GENERATED");
    expect(customIndexContent).toContain("declare module '@brand-map/postgres/custom' { }");
  });

  test("does not overwrite existing custom type files but still writes new ones", async () => {
    const outDir = makeTempDir();
    const customDir = path.join(outDir, "custom");
    const existingPath = path.join(customDir, "PgExisting.d.ts");
    const existingContent = "export type PgExisting = 'keep-me';\n";
    const warnings: string[] = [];

    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(existingPath, existingContent, { flag: "w" });

    await generate(
      {
        outDir,
        progressListener: false,
        warningListener: (msg) => warnings.push(msg),
      },
      {
        tsForConfig: async () => ({
          ts: "export type Schema = true;\n",
          customTypeSourceFiles: {
            PgExisting: "export type PgExisting = 'new-value';\n",
            PgNewType: "export type PgNewType = boolean;\n",
          },
        }),
      },
    );

    expect(fs.readFileSync(existingPath, "utf8")).toBe(existingContent);
    expect(fs.readFileSync(path.join(customDir, "PgNewType.d.ts"), "utf8")).toBe("export type PgNewType = boolean;\n");
    expect(warnings.some((msg) => msg.includes("PgNewType.d.ts"))).toBe(true);
    expect(warnings.some((msg) => msg.includes("PgExisting.d.ts"))).toBe(false);
  });

  test("respects outExt for generated schema and custom file paths", async () => {
    const outDir = makeTempDir();

    await generate(
      { outDir, outExt: ".ts", progressListener: false, warningListener: false },
      {
        tsForConfig: async () => ({
          ts: "export type SchemaExt = '.ts';\n",
          customTypeSourceFiles: {
            PgTypeTs: "export type PgTypeTs = 'ok';\n",
          },
        }),
      },
    );

    expect(fs.existsSync(path.join(outDir, "brand-map-postgres.schema.ts"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "custom", "PgTypeTs.ts"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "custom", "index.ts"))).toBe(true);
  });
});
