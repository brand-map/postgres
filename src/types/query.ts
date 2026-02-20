export interface SqlQuery {
  text: string;
  values: any[];
  name?: string;
}

export interface QueryResult<Row = any> {
  rows: Row[];
}
