// this file exists only to suppress type errors when compiling the files in src/db

export type Table = string;
export type Column = string;
export type Updatable = { [k: string]: unknown };
export type Whereable = { [k: string]: unknown };
export type Insertable = { [k: string]: unknown };
export type JsonSelectableForTable<T extends Table> = { [k: string]: unknown };
export type SelectableForTable<T extends Table> = { [k: string]: unknown };
export type WhereableForTable<T extends Table> = { [k: string]: unknown };
export type InsertableForTable<T extends Table> = { [k: string]: unknown };
export type UpdatableForTable<T extends Table> = { [k: string]: unknown };
export type ColumnForTable<T extends Table> = string;
export type UniqueIndexForTable<T extends Table> = string;
export type SqlForTable<T extends Table> = unknown;
