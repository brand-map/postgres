import type { SqlQuery } from "../types"

export interface Config {
  transactionAttemptsMax: number
  transactionRetryDelay: { min: number; max: number }
  castArrayParamsToJson: boolean // see https://github.com/brianc/node-postgres/issues/2012
  castObjectParamsToJson: boolean // useful if json will be cast onward differently from text
  queryListener?(query: SqlQuery, transactionId?: number): void
  resultListener?(result: any, transactionId?: number, elapsed?: number, query?: SqlQuery): void
  transactionListener?(message: string, transactionId?: number): void
}
export type NewConfig = Partial<Config>

// defaults
let config: Config = {
  transactionAttemptsMax: 5,
  transactionRetryDelay: { min: 25, max: 250 },
  castArrayParamsToJson: false,
  castObjectParamsToJson: false
}

/**
 * Get (a copy of) the current configuration.
 */
export const getConfig = () => ({ ...config })

/**
 * Set key(s) on the configuration.
 * @param newConfig Partial configuration object
 */
export const setConfig = (newConfig: NewConfig) => (config = { ...config, ...newConfig })
