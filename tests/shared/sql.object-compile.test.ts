import { describe, expect, test } from "bun:test";

import { cols, param, self, sql, vals } from "../../src/shared/db/core";

describe("sql object compile output", () => {
  test("compiles where object into stable SQL text and values", () => {
    const where = { b: 2, a: 1 };
    const query = sql`SELECT * FROM ${"users"} WHERE ${where}`;

    const compiled = query.compile();

    expect(compiled).toEqual({
      text: 'SELECT * FROM "users" WHERE ("a" = $1 AND "b" = $2)',
      values: [1, 2],
    });
  });

  test("compiles camelCase object keys to snake_case column names", () => {
    const where = { displayName: "Alice", createdAt: "2026-01-01" };
    const query = sql`SELECT * FROM ${"users"} WHERE ${where}`;

    const compiled = query.compile();

    expect(compiled).toEqual({
      text: 'SELECT * FROM "users" WHERE ("created_at" = $1 AND "display_name" = $2)',
      values: ["2026-01-01", "Alice"],
    });
  });

  test("compiles cols/vals object in deterministic key order", () => {
    const row = { zeta: 5, alpha: 1, beta: 2 };
    const query = sql`INSERT INTO ${"sampleTable"} (${cols(row)}) VALUES (${vals(row)})`;

    const compiled = query.compile();

    expect(compiled).toEqual({
      text: 'INSERT INTO "sample_table" ("alpha", "beta", "zeta") VALUES ($1, $2, $3)',
      values: [1, 2, 5],
    });
  });

  test("same logical where object always compiles to same query object", () => {
    const whereA = { b: 2, a: 1 };
    const whereB = { a: 1, b: 2 };
    const queryA = sql`SELECT * FROM ${"users"} WHERE ${whereA}`;
    const queryB = sql`SELECT * FROM ${"users"} WHERE ${whereB}`;

    const compiledA = queryA.compile();
    const compiledB = queryB.compile();

    expect(compiledA).toEqual(compiledB);
  });

  test("where object supports sql fragments and keeps stable values order", () => {
    const where = {
      score: sql`${self} > ${param(10)}`,
      userId: 7,
    };
    const query = sql`SELECT * FROM ${"scores"} WHERE ${where}`;

    const compiled = query.compile();

    expect(compiled).toEqual({
      text: 'SELECT * FROM "scores" WHERE (("score" > $1) AND "user_id" = $2)',
      values: [10, 7],
    });
  });
});
