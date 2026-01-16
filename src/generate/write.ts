import * as fs from "node:fs";
import * as path from "node:path";

import { finaliseConfig, type Config } from "./config";
import { header } from "./header";
import { tsForConfig } from "./ts-output";

/**
 * Generate a schema and supporting files and folders given a configuration.
 * @param suppliedConfig An object approximately matching `brand-map-postgres.config.json`.
 */
export async function generate(suppliedConfig: Config) {
  const config = finaliseConfig(suppliedConfig);
  const log = config.progressListener === true ? console.log : config.progressListener || (() => void 0);
  const warn = config.warningListener === true ? console.log : config.warningListener || (() => void 0);
  const debug = config.debugListener === true ? console.log : config.debugListener || (() => void 0);
  const { ts, customTypeSourceFiles } = await tsForConfig(config, debug);
  const schemaName = `brand-map-postgres.schema${config.outExt}`;
  const customFolderName = "custom";
  const customTypesIndexName = `index${config.outExt}`;
  const folderTargetPath = path.join(config.outDir);
  const schemaTargetPath = path.join(folderTargetPath, schemaName);
  const customFolderTargetPath = path.join(folderTargetPath, customFolderName);
  const customTypesIndexTargetPath = path.join(customFolderTargetPath, customTypesIndexName);

  const customTypesIndexContent =
    header() +
    `
// this empty declaration appears to fix relative imports in other custom type files
declare module '@brand-map/postgres/custom' { }
`;

  log(`(Re)creating schema folder: ${schemaTargetPath}`);
  fs.mkdirSync(folderTargetPath, { recursive: true });

  log(`Writing generated schema: ${schemaTargetPath}`);
  fs.writeFileSync(schemaTargetPath, ts, { flag: "w" });

  if (Object.keys(customTypeSourceFiles).length > 0) {
    fs.mkdirSync(customFolderTargetPath, { recursive: true });

    for (const customTypeFileName in customTypeSourceFiles) {
      const customTypeFilePath = path.join(customFolderTargetPath, customTypeFileName + config.outExt);

      if (fs.existsSync(customTypeFilePath)) {
        log(`Custom type or domain declaration file already exists: ${customTypeFilePath}`);
      } else {
        warn(`Writing new custom type or domain placeholder file: ${customTypeFilePath}`);
        const customTypeFileContent = customTypeSourceFiles[customTypeFileName]!;
        fs.writeFileSync(customTypeFilePath, customTypeFileContent, { flag: "w" });
      }
    }

    log(`Writing custom types file: ${customTypesIndexTargetPath}`);
    fs.writeFileSync(customTypesIndexTargetPath, customTypesIndexContent, { flag: "w" });
  }

  // legacy.srcWarning(config);
}
