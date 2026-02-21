import type { BunSqlQueryable } from "../../shared/db/core"

import { getConfig } from "../../shared/config"
import { isDatabaseError } from "../../shared/db/postgres-errors"
import { wait } from "../../shared/utils"

// these are the only meaningful values in Postgres:
// https://www.postgresql.org/docs/18/sql-set-transaction.html
export const Serializable = "SERIALIZABLE"
export type Serializable = typeof Serializable

export const RepeatableRead = "REPEATABLE READ"
export type RepeatableRead = typeof RepeatableRead

export const ReadCommitted = "READ COMMITTED"
export type ReadCommitted = typeof ReadCommitted

export const SerializableReadOnly = "SERIALIZABLE, READ ONLY"
export type SerializableReadOnly = typeof SerializableReadOnly

export const RepeatableReadReadOnly = "REPEATABLE READ, READ ONLY"
export type RepeatableReadReadOnly = typeof RepeatableReadReadOnly

export const ReadCommittedReadOnly = "READ COMMITTED, READ ONLY"
export type ReadCommittedReadOnly = typeof ReadCommittedReadOnly

export const SerializableReadOnlyDeferrable = "SERIALIZABLE, READ ONLY, DEFERRABLE"
export type SerializableReadOnlyDeferrable = typeof SerializableReadOnlyDeferrable

export const IsolationLevel = {
  Serializable,
  RepeatableRead,
  ReadCommitted,
  SerializableReadOnly,
  RepeatableReadReadOnly,
  ReadCommittedReadOnly,
  SerializableReadOnlyDeferrable
} as const

export type IsolationLevel = Serializable | RepeatableRead | ReadCommitted | SerializableReadOnly | RepeatableReadReadOnly | ReadCommittedReadOnly | SerializableReadOnlyDeferrable

export type IsolationSatisfying<T extends IsolationLevel> = {
  [Serializable]: Serializable
  [RepeatableRead]: IsolationSatisfying<Serializable> | RepeatableRead
  [ReadCommitted]: IsolationSatisfying<RepeatableRead> | ReadCommitted
  [SerializableReadOnly]: IsolationSatisfying<Serializable> | SerializableReadOnly
  [RepeatableReadReadOnly]: IsolationSatisfying<SerializableReadOnly> | IsolationSatisfying<RepeatableRead> | RepeatableReadReadOnly
  [ReadCommittedReadOnly]: IsolationSatisfying<RepeatableReadReadOnly> | IsolationSatisfying<ReadCommitted> | ReadCommittedReadOnly
  [SerializableReadOnlyDeferrable]: IsolationSatisfying<SerializableReadOnly> | SerializableReadOnlyDeferrable
}[T]

export type BunTransactionClient<T extends IsolationLevel> = BunSqlQueryable & {
  __bmPostgres?: { isolationLevel: T; transactionId: number }
}

export type TransactionClient<T extends IsolationLevel> = BunTransactionClient<T>

export type TransactionClientForSerializable = TransactionClient<IsolationSatisfying<Serializable>>
export type TransactionClientForRepeatableRead = TransactionClient<IsolationSatisfying<RepeatableRead>>
export type TransactionClientForReadCommitted = TransactionClient<IsolationSatisfying<ReadCommitted>>
export type TransactionClientForSerializableReadOnly = TransactionClient<IsolationSatisfying<SerializableReadOnly>>
export type TransactionClientForRepeatableReadReadOnly = TransactionClient<IsolationSatisfying<RepeatableReadReadOnly>>
export type TransactionClientForReadCommittedReadOnly = TransactionClient<IsolationSatisfying<ReadCommittedReadOnly>>
export type TransactionClientForSerializableReadOnlyDeferrable = TransactionClient<IsolationSatisfying<SerializableReadOnlyDeferrable>>

export interface BunTransactionQueryable extends BunSqlQueryable {
  begin<T>(options: string, callback: (client: BunTransactionClient<IsolationLevel>) => Promise<T>): Promise<T>
}

function isBunSqlTransactionQueryable(queryable: BunTransactionQueryable | TransactionClient<IsolationLevel>): queryable is BunTransactionQueryable {
  return typeof (queryable as { begin?: unknown }).begin === "function"
}

let transactionSequence = 0

/**
 * Provide a Bun SQL transaction client to the callback.
 */
export async function transaction<T, M extends IsolationLevel>(
  transactionClientOrQueryable: BunTransactionQueryable | TransactionClient<IsolationSatisfying<M>>,
  isolationLevel: M,
  callback: (client: TransactionClient<IsolationSatisfying<M>>) => Promise<T>
): Promise<T> {
  if (Object.hasOwn(transactionClientOrQueryable, "__bmPostgres")) {
    return callback(transactionClientOrQueryable as TransactionClient<IsolationSatisfying<M>>)
  }

  if (!isBunSqlTransactionQueryable(transactionClientOrQueryable)) {
    throw new Error(`Unsupported transaction queryable: expected Bun SQL client`)
  }

  if (transactionSequence >= Number.MAX_SAFE_INTEGER - 1) {
    transactionSequence = 0
  }

  const transactionId = transactionSequence++
  const config = getConfig()
  const { transactionListener } = config
  const maxAttempts = config.transactionAttemptsMax
  const { min, max } = config.transactionRetryDelay
  const beginOptions = `ISOLATION LEVEL ${isolationLevel}`

  for (let attempt = 1; ; attempt++) {
    try {
      if (attempt > 1 && transactionListener) {
        transactionListener(`Retrying transaction, attempt ${attempt} of ${maxAttempts}`, transactionId)
      }

      return await transactionClientOrQueryable.begin(beginOptions, async bunTransactionClient => {
        const transactionClient = bunTransactionClient as TransactionClient<IsolationSatisfying<M>>
        transactionClient.__bmPostgres = { isolationLevel: isolationLevel as IsolationSatisfying<M>, transactionId }
        try {
          return await callback(transactionClient)
        } finally {
          delete transactionClient.__bmPostgres
        }
      })
    } catch (err: any) {
      if (!isDatabaseError(err, "TransactionRollback_SerializationFailure", "TransactionRollback_DeadlockDetected")) {
        throw err
      }

      if (attempt >= maxAttempts) {
        if (transactionListener) {
          transactionListener(`Transaction rollback (code ${err.code}) on attempt ${attempt} of ${maxAttempts}, giving up`, transactionId)
        }
        throw err
      }

      const delayBeforeRetry = Math.round(min + (max - min) * Math.random())
      if (transactionListener) {
        transactionListener(`Transaction rollback (code ${err.code}) on attempt ${attempt} of ${maxAttempts}, retrying in ${delayBeforeRetry}ms`, transactionId)
      }
      await wait(delayBeforeRetry)
    }
  }
}

export async function serializable<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TransactionClientForSerializable,
  callback: (client: TransactionClientForSerializable) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.Serializable, callback)
}

export async function repeatableRead<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TransactionClientForRepeatableRead,
  callback: (client: TransactionClientForRepeatableRead) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.RepeatableRead, callback)
}

export async function readCommitted<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TransactionClientForReadCommitted,
  callback: (client: TransactionClientForReadCommitted) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.ReadCommitted, callback)
}

export async function serializableReadOnly<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TransactionClientForSerializableReadOnly,
  callback: (client: TransactionClientForSerializableReadOnly) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.SerializableReadOnly, callback)
}

export async function repeatableReadReadOnly<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TransactionClientForRepeatableReadReadOnly,
  callback: (client: TransactionClientForRepeatableReadReadOnly) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.RepeatableReadReadOnly, callback)
}

export async function readCommittedReadOnly<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TransactionClientForReadCommittedReadOnly,
  callback: (client: TransactionClientForReadCommittedReadOnly) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.ReadCommittedReadOnly, callback)
}

export async function serializableReadOnlyDeferrable<T>(
  transactionClientOrQueryable: BunTransactionQueryable | TransactionClientForSerializableReadOnlyDeferrable,
  callback: (client: TransactionClientForSerializableReadOnlyDeferrable) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.SerializableReadOnlyDeferrable, callback)
}
