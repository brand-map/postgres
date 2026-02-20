import { getConfig } from "../../shared/db/config";
import type { BunSqlQueryable } from "../../shared/db/core";
import { isDatabaseError } from "../../shared/db/pg-errors";
import { wait } from "../../shared/db/utils";

// these are the only meaningful values in Postgres:
// https://www.postgresql.org/docs/18/sql-set-transaction.html
export const Serializable = "SERIALIZABLE";
export type Serializable = typeof Serializable;

export const RepeatableRead = "REPEATABLE READ";
export type RepeatableRead = typeof RepeatableRead;

export const ReadCommitted = "READ COMMITTED";
export type ReadCommitted = typeof ReadCommitted;

export const SerializableReadOnly = "SERIALIZABLE, READ ONLY";
export type SerializableReadOnly = typeof SerializableReadOnly;

export const RepeatableReadReadOnly = "REPEATABLE READ, READ ONLY";
export type RepeatableReadReadOnly = typeof RepeatableReadReadOnly;

export const ReadCommittedReadOnly = "READ COMMITTED, READ ONLY";
export type ReadCommittedReadOnly = typeof ReadCommittedReadOnly;

export const SerializableReadOnlyDeferrable = "SERIALIZABLE, READ ONLY, DEFERRABLE";
export type SerializableReadOnlyDeferrable = typeof SerializableReadOnlyDeferrable;

export const IsolationLevel = {
  Serializable,
  RepeatableRead,
  ReadCommitted,
  SerializableReadOnly,
  RepeatableReadReadOnly,
  ReadCommittedReadOnly,
  SerializableReadOnlyDeferrable,
} as const;

export type IsolationLevel = Serializable | RepeatableRead | ReadCommitted | SerializableReadOnly | RepeatableReadReadOnly | ReadCommittedReadOnly | SerializableReadOnlyDeferrable;

export type IsolationSatisfying<T extends IsolationLevel> = {
  [Serializable]: Serializable;
  [RepeatableRead]: IsolationSatisfying<Serializable> | RepeatableRead;
  [ReadCommitted]: IsolationSatisfying<RepeatableRead> | ReadCommitted;
  [SerializableReadOnly]: IsolationSatisfying<Serializable> | SerializableReadOnly;
  [RepeatableReadReadOnly]: IsolationSatisfying<SerializableReadOnly> | IsolationSatisfying<RepeatableRead> | RepeatableReadReadOnly;
  [ReadCommittedReadOnly]: IsolationSatisfying<RepeatableReadReadOnly> | IsolationSatisfying<ReadCommitted> | ReadCommittedReadOnly;
  [SerializableReadOnlyDeferrable]: IsolationSatisfying<SerializableReadOnly> | SerializableReadOnlyDeferrable;
}[T];

export type BunTxnClient<T extends IsolationLevel> = BunSqlQueryable & {
  _brand_map_postgres?: { isolationLevel: T; txnId: number };
};

export type TransactionClient<T extends IsolationLevel> = BunTxnClient<T>;

export type TxnClientForSerializable = TransactionClient<IsolationSatisfying<Serializable>>;
export type TxnClientForRepeatableRead = TransactionClient<IsolationSatisfying<RepeatableRead>>;
export type TxnClientForReadCommitted = TransactionClient<IsolationSatisfying<ReadCommitted>>;
export type TxnClientForSerializableReadOnly = TransactionClient<IsolationSatisfying<SerializableReadOnly>>;
export type TxnClientForRepeatableReadReadOnly = TransactionClient<IsolationSatisfying<RepeatableReadReadOnly>>;
export type TxnClientForReadCommittedReadOnly = TransactionClient<IsolationSatisfying<ReadCommittedReadOnly>>;
export type TxnClientForSerializableReadOnlyDeferrable = TransactionClient<IsolationSatisfying<SerializableReadOnlyDeferrable>>;

export interface BunTransactionQueryable extends BunSqlQueryable {
  begin<T>(options: string, callback: (client: BunTxnClient<IsolationLevel>) => Promise<T>): Promise<T>;
}

function isBunSqlTransactionQueryable(queryable: BunTransactionQueryable | TransactionClient<IsolationLevel>): queryable is BunTransactionQueryable {
  return typeof (queryable as { begin?: unknown }).begin === "function";
}

let txnSeq = 0;

/**
 * Provide a Bun SQL transaction client to the callback.
 */
export async function transaction<T, M extends IsolationLevel>(
  transactionClientOrQueryable: BunTransactionQueryable | TransactionClient<IsolationSatisfying<M>>,
  isolationLevel: M,
  callback: (client: TransactionClient<IsolationSatisfying<M>>) => Promise<T>,
): Promise<T> {
  if (Object.hasOwn(transactionClientOrQueryable, "_brand_map_postgres")) {
    return callback(transactionClientOrQueryable as TransactionClient<IsolationSatisfying<M>>);
  }

  if (!isBunSqlTransactionQueryable(transactionClientOrQueryable)) {
    throw new Error(`Unsupported transaction queryable: expected Bun SQL client`);
  }

  if (txnSeq >= Number.MAX_SAFE_INTEGER - 1) {
    txnSeq = 0;
  }

  const txnId = txnSeq++;
  const config = getConfig();
  const { transactionListener } = config;
  const maxAttempts = config.transactionAttemptsMax;
  const { minMs, maxMs } = config.transactionRetryDelay;
  const beginOptions = `ISOLATION LEVEL ${isolationLevel}`;

  for (let attempt = 1; ; attempt++) {
    try {
      if (attempt > 1 && transactionListener) {
        transactionListener(`Retrying transaction, attempt ${attempt} of ${maxAttempts}`, txnId);
      }

      return await transactionClientOrQueryable.begin(beginOptions, async (bunTxnClient) => {
        const transactionClient = bunTxnClient as TransactionClient<IsolationSatisfying<M>>;
        transactionClient._brand_map_postgres = { isolationLevel: isolationLevel as IsolationSatisfying<M>, txnId };
        try {
          return await callback(transactionClient);
        } finally {
          delete transactionClient._brand_map_postgres;
        }
      });
    } catch (err: any) {
      if (!isDatabaseError(err, "TransactionRollback_SerializationFailure", "TransactionRollback_DeadlockDetected")) {
        throw err;
      }

      if (attempt >= maxAttempts) {
        if (transactionListener) {
          transactionListener(`Transaction rollback (code ${err.code}) on attempt ${attempt} of ${maxAttempts}, giving up`, txnId);
        }
        throw err;
      }

      const delayBeforeRetry = Math.round(minMs + (maxMs - minMs) * Math.random());
      if (transactionListener) {
        transactionListener(`Transaction rollback (code ${err.code}) on attempt ${attempt} of ${maxAttempts}, retrying in ${delayBeforeRetry}ms`, txnId);
      }
      await wait(delayBeforeRetry);
    }
  }
}

export async function serializable<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TxnClientForSerializable,
  callback: (client: TxnClientForSerializable) => Promise<T>,
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.Serializable, callback);
}

export async function repeatableRead<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TxnClientForRepeatableRead,
  callback: (client: TxnClientForRepeatableRead) => Promise<T>,
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.RepeatableRead, callback);
}

export async function readCommitted<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TxnClientForReadCommitted,
  callback: (client: TxnClientForReadCommitted) => Promise<T>,
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.ReadCommitted, callback);
}

export async function serializableReadOnly<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TxnClientForSerializableReadOnly,
  callback: (client: TxnClientForSerializableReadOnly) => Promise<T>,
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.SerializableReadOnly, callback);
}

export async function repeatableReadReadOnly<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TxnClientForRepeatableReadReadOnly,
  callback: (client: TxnClientForRepeatableReadReadOnly) => Promise<T>,
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.RepeatableReadReadOnly, callback);
}

export async function readCommittedReadOnly<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TxnClientForReadCommittedReadOnly,
  callback: (client: TxnClientForReadCommittedReadOnly) => Promise<T>,
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.ReadCommittedReadOnly, callback);
}

export async function serializableReadOnlyDeferrable<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TxnClientForSerializableReadOnlyDeferrable,
  callback: (client: TxnClientForSerializableReadOnlyDeferrable) => Promise<T>,
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.SerializableReadOnlyDeferrable, callback);
}
