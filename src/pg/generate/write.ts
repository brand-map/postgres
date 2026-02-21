import * as fs from "node:fs"
import * as path from "node:path"

import { header } from "../../shared/generate/header"
import { finaliseConfig, type Config } from "./config"
import { tsForConfig } from "./ts-output"

type GenerateDeps = {
  existsSync: typeof fs.existsSync
  header: typeof header
  join: typeof path.join
  mkdirSync: typeof fs.mkdirSync
  tsForConfig: typeof tsForConfig
  writeFileSync: typeof fs.writeFileSync
}

const defaultDeps: GenerateDeps = {
  existsSync: fs.existsSync,
  header,
  join: path.join,
  mkdirSync: fs.mkdirSync,
  tsForConfig,
  writeFileSync: fs.writeFileSync
}

/**
 * Generate a schema and supporting files and folders given a configuration.
 * @param suppliedConfig An object approximately matching `brand-map-postgres.config.json`.
 */
export async function generate(suppliedConfig: Config, deps: Partial<GenerateDeps> = {}) {
  const resolvedDeps = { ...defaultDeps, ...deps }
  const config = finaliseConfig(suppliedConfig)
  const log = config.progressListener === true ? console.log : config.progressListener || (() => void 0)
  const warn = config.warningListener === true ? console.log : config.warningListener || (() => void 0)
  const debug = config.debugListener === true ? console.log : config.debugListener || (() => void 0)
  const { ts, customTypeSourceFiles } = await resolvedDeps.tsForConfig(config, debug)
  const schemaName = `brand-map-postgres.schema${config.outExt}`
  const customFolderName = "custom"
  const customTypesIndexName = `index${config.outExt}`
  const folderTargetPath = resolvedDeps.join(config.outDir)
  const schemaTargetPath = resolvedDeps.join(folderTargetPath, schemaName)
  const customFolderTargetPath = resolvedDeps.join(folderTargetPath, customFolderName)
  const customTypesIndexTargetPath = resolvedDeps.join(customFolderTargetPath, customTypesIndexName)

  const customTypesIndexContent =
    resolvedDeps.header() +
    `
// this empty declaration appears to fix relative imports in other custom type files
declare module '@brand-map/postgres/custom' { }
`

  log(`(Re)creating schema folder: ${schemaTargetPath}`)
  resolvedDeps.mkdirSync(folderTargetPath, { recursive: true })

  log(`Writing generated schema: ${schemaTargetPath}`)
  resolvedDeps.writeFileSync(schemaTargetPath, ts, { flag: "w" })

  if (Object.keys(customTypeSourceFiles).length > 0) {
    resolvedDeps.mkdirSync(customFolderTargetPath, { recursive: true })

    for (const customTypeFileName in customTypeSourceFiles) {
      const customTypeFilePath = resolvedDeps.join(customFolderTargetPath, customTypeFileName + config.outExt)

      if (resolvedDeps.existsSync(customTypeFilePath)) {
        log(`Custom type or domain declaration file already exists: ${customTypeFilePath}`)
      } else {
        warn(`Writing new custom type or domain placeholder file: ${customTypeFilePath}`)
        const customTypeFileContent = customTypeSourceFiles[customTypeFileName]!
        resolvedDeps.writeFileSync(customTypeFilePath, customTypeFileContent, { flag: "w" })
      }
    }

    log(`Writing custom types file: ${customTypesIndexTargetPath}`)
    resolvedDeps.writeFileSync(customTypesIndexTargetPath, customTypesIndexContent, { flag: "w" })
  }

  // legacy.srcWarning(config);
}
