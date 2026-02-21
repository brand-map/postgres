import { join } from "node:path"

import { header } from "../shared/generate-header"
import { finaliseConfig, type Config } from "./generate-config"
import { tsForConfig } from "./generate-ts-output"

type GenerateDeps = {
  file: typeof Bun.file
  header: typeof header
  join: typeof join
  tsForConfig: typeof tsForConfig
  write: typeof Bun.write
}

const defaultDeps: GenerateDeps = {
  file: Bun.file,
  header,
  join: join,
  tsForConfig,
  write: Bun.write
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

  log(`Writing generated schema: ${schemaTargetPath}`)
  await resolvedDeps.write(schemaTargetPath, ts, { createPath: true })

  if (Object.keys(customTypeSourceFiles).length > 0) {
    for (const customTypeFileName in customTypeSourceFiles) {
      const customTypeFilePath = resolvedDeps.join(customFolderTargetPath, customTypeFileName + config.outExt)

      if (await resolvedDeps.file(customTypeFilePath).exists()) {
        log(`Custom type or domain declaration file already exists: ${customTypeFilePath}`)
      } else {
        warn(`Writing new custom type or domain placeholder file: ${customTypeFilePath}`)
        const customTypeFileContent = customTypeSourceFiles[customTypeFileName]!
        await resolvedDeps.write(customTypeFilePath, customTypeFileContent, { createPath: true })
      }
    }

    log(`Writing custom types file: ${customTypesIndexTargetPath}`)
    await resolvedDeps.write(customTypesIndexTargetPath, customTypesIndexContent, { createPath: true })
  }

  // legacy.srcWarning(config);
}
