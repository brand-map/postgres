export interface SqlQuery {
  text: string;
  values: any[];
  name?: string;
}

export interface Config {
  transactionAttemptsMax: number;
  transactionRetryDelay: { minMs: number; maxMs: number };
  castArrayParamsToJson: boolean; // see https://github.com/brianc/node-postgres/issues/2012
  castObjectParamsToJson: boolean; // useful if json will be cast onward differently from text
  queryListener?(query: SqlQuery, txnId?: number): void;
  resultListener?(result: any, txnId?: number, elapsedMs?: number, query?: SqlQuery): void;
  transactionListener?(message: string, txnId?: number): void;
}
export type NewConfig = Partial<Config>;

// defaults
let config: Config = {
  transactionAttemptsMax: 5,
  transactionRetryDelay: { minMs: 25, maxMs: 250 },
  castArrayParamsToJson: false,
  castObjectParamsToJson: false,
};

/**
 * Get (a copy of) the current configuration.
 */
export const getConfig = () => ({ ...config });

/**
 * Set key(s) on the configuration.
 * @param newConfig Partial configuration object
 */
export const setConfig = (newConfig: NewConfig) => (config = { ...config, ...newConfig });
