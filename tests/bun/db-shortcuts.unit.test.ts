import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"

import { ALL, parent, sql } from "../../src/bun/db-core"
import {
  Constraint,
  NotExactlyOneError,
  avg,
  constraint,
  count,
  deletes,
  doNothing,
  insert,
  max,
  min,
  select,
  selectExactlyOne,
  selectOne,
  sum,
  truncate,
  update,
  upsert
} from "../../src/bun/db-shortcuts"
import { IsolationLevel, transaction } from "../../src/bun/db-transaction"
import { createBunPgliteFixture, type BunPgliteFixture } from "../shared/bun-pglite.helpers"

let fixture: BunPgliteFixture

beforeAll(async () => {
  fixture = await createBunPgliteFixture("bm_bun_shortcuts")
})

beforeEach(async () => {
  await fixture.reset()
})

afterAll(async () => {
  await fixture.close()
})

describe("bun db-shortcuts compilation", () => {
  test("insert compiles single row, many rows, and empty row no-op", () => {
    expect(insert("users" as any, { id: 1, name: "a" } as any).compile()).toEqual({
      text: 'INSERT INTO "users" ("id", "name") VALUES ($1, $2) RETURNING to_jsonb("users".*) AS result',
      values: [1, "a"]
    })

    expect(insert("users" as any, [{ id: 1, name: "a" }, { id: 2 }] as any).compile()).toEqual({
      text: 'INSERT INTO "users" ("id", "name") VALUES ($1, $2), ($3, DEFAULT) RETURNING to_jsonb("users".*) AS result',
      values: [1, "a", 2]
    })

    expect(insert("users" as any, [] as any).compile()).toEqual({
      text: '/* marked no-op: won\'t hit DB unless forced -> */ INSERT INTO "users" SELECT null WHERE false',
      values: []
    })
  })

  test("insert supports returning/extras clauses", () => {
    const compiled = insert("users" as any, { id: 1, name: "a" } as any, {
      returning: ["id"] as any,
      extras: { upper_name: sql`upper(${"name"})` } as any
    }).compile()

    expect(compiled).toEqual({
      text: 'INSERT INTO "users" ("id", "name") VALUES ($1, $2) RETURNING jsonb_build_object($3::text, "id") || jsonb_build_object($4::text, upper("name")) AS result',
      values: [1, "a", "id", "upper_name"]
    })
  })

  test("constraint wrapper and doNothing helper are usable in upsert", () => {
    expect(constraint("users_name_key" as any)).toBeInstanceOf(Constraint)
    expect(doNothing).toEqual([])

    expect(upsert("users" as any, { id: 1, name: "a" } as any, "id" as any, { updateColumns: doNothing as any }).compile()).toEqual({
      text: 'INSERT INTO "users" ("id", "name") VALUES ($1, $2) ON CONFLICT ("id") DO NOTHING RETURNING to_jsonb("users".*) || jsonb_build_object(\'$action\', CASE xmax WHEN 0 THEN \'INSERT\' ELSE \'UPDATE\' END) AS result',
      values: [1, "a"]
    })

    expect(
      upsert("users" as any, { id: 1, name: "a" } as any, constraint("users_name_key" as any), {
        reportAction: "suppress" as any,
        updateValues: { name: "b" } as any
      }).compile()
    ).toEqual({
      text: 'INSERT INTO "users" ("id", "name") VALUES ($1, $2) ON CONFLICT ON CONSTRAINT "users_name_key" DO UPDATE SET ("id", "name") = ROW(EXCLUDED."id", "b") RETURNING to_jsonb("users".*) AS result',
      values: [1, "a"]
    })

    expect(
      upsert("users" as any, { id: 1, score: 2 } as any, "id" as any, {
        noNullUpdateColumns: ["score"] as any
      }).compile()
    ).toEqual({
      text: 'INSERT INTO "users" ("id", "score") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET ("id", "score") = ROW(EXCLUDED."id", CASE WHEN EXCLUDED."score" IS NULL THEN "users"."score" ELSE EXCLUDED."score" END) RETURNING to_jsonb("users".*) || jsonb_build_object(\'$action\', CASE xmax WHEN 0 THEN \'INSERT\' ELSE \'UPDATE\' END) AS result',
      values: [1, 2]
    })
  })

  test("update/deletes/truncate compile expected SQL", () => {
    expect(
      update("users" as any, { name: "x" } as any, { id: 1 } as any, {
        returning: ["id"] as any,
        extras: { alias_name: "name" as any } as any
      }).compile()
    ).toEqual({
      text: 'UPDATE "users" SET ("name") = ROW($1) WHERE ("id" = $2) RETURNING jsonb_build_object($3::text, "id") || jsonb_build_object($4::text, "name") AS result',
      values: ["x", 1, "id", "alias_name"]
    })

    expect(
      deletes("users" as any, { id: 1 } as any, {
        returning: ["id"] as any,
        extras: { alias_name: "name" as any } as any
      }).compile()
    ).toEqual({
      text: 'DELETE FROM "users" WHERE ("id" = $1) RETURNING jsonb_build_object($2::text, "id") || jsonb_build_object($3::text, "name") AS result',
      values: [1, "id", "alias_name"]
    })

    expect(truncate(["users", "posts"] as any, "CONTINUE IDENTITY", "RESTRICT").compile()).toEqual({
      text: 'TRUNCATE "users", "posts" CONTINUE IDENTITY RESTRICT',
      values: []
    })
  })

  test("select family compiles expected SQL across modes and options", () => {
    expect(select("users" as any, ALL).compile()).toEqual({
      text: 'SELECT coalesce(jsonb_agg(result), \'[]\') AS result FROM (SELECT to_jsonb("users".*) AS result FROM "users") AS "sq_users"',
      values: []
    })

    expect(
      select("users" as any, { active: true } as any, {
        distinct: ["name"] as any,
        order: [{ by: "name", direction: "ASC", nulls: "LAST" }],
        limit: 10,
        offset: 5
      } as any).compile()
    ).toEqual({
      text: 'SELECT coalesce(jsonb_agg(result), \'[]\') AS result FROM (SELECT DISTINCT ON ("name") to_jsonb("users".*) AS result FROM "users" WHERE ("active" = $1) ORDER BY "name" ASC NULLS LAST LIMIT $2 OFFSET $3) AS "sq_users"',
      values: [true, 10, 5]
    })

    expect(
      select("users" as any, ALL, {
        groupBy: ["name"] as any,
        having: sql`${"name"} IS NOT NULL`
      } as any).compile()
    ).toEqual({
      text: 'SELECT coalesce(jsonb_agg(result), \'[]\') AS result FROM (SELECT to_jsonb("users".*) AS result FROM "users" GROUP BY "name" HAVING "name" IS NOT NULL) AS "sq_users"',
      values: []
    })

    expect(
      select("users" as any, ALL, {
        alias: "u",
        lateral: {
          post_count: count("posts" as any, { user_id: parent("id") } as any)
        }
      } as any).compile()
    ).toEqual({
      text: 'SELECT coalesce(jsonb_agg(result), \'[]\') AS result FROM (SELECT to_jsonb("u".*) || jsonb_build_object($1::text, "lateral_post_count".result) AS result FROM "users" AS "u" LEFT JOIN LATERAL (SELECT count(*) AS result FROM "posts" WHERE ("user_id" = "u"."id")) AS "lateral_post_count" ON true) AS "sq_u"',
      values: ["post_count"]
    })

    expect(
      select("users" as any, ALL, {
        alias: "u",
        lateral: count("posts" as any, { user_id: parent("id") } as any)
      } as any).compile()
    ).toEqual({
      text: 'SELECT coalesce(jsonb_agg(result), \'[]\') AS result FROM (SELECT "lateral_passthru".result AS result FROM "users" AS "u" LEFT JOIN LATERAL (SELECT count(*) AS result FROM "posts" WHERE ("user_id" = "u"."id")) AS "lateral_passthru" ON true) AS "sq_u"',
      values: []
    })

    expect(
      select("users" as any, { id: 1 } as any, {
        lock: [
          { for: "UPDATE", of: ["users", "u"] as any, wait: "NOWAIT" },
          { for: "SHARE" }
        ]
      } as any).compile()
    ).toEqual({
      text: 'SELECT coalesce(jsonb_agg(result), \'[]\') AS result FROM (SELECT to_jsonb("users".*) AS result FROM "users" WHERE ("id" = $1) FOR UPDATE OF "users", "u" NOWAIT FOR SHARE) AS "sq_users"',
      values: [1]
    })

    expect(selectOne("users" as any, { id: 1 } as any).compile()).toEqual({
      text: 'SELECT to_jsonb("users".*) AS result FROM "users" WHERE ("id" = $1) LIMIT $2',
      values: [1, 1]
    })

    expect(selectExactlyOne("users" as any, { id: 1 } as any).compile()).toEqual({
      text: 'SELECT to_jsonb("users".*) AS result FROM "users" WHERE ("id" = $1) LIMIT $2',
      values: [1, 1]
    })

    expect(count("users" as any, ALL).compile()).toEqual({
      text: 'SELECT count(*) AS result FROM "users"',
      values: []
    })
    expect(sum("users" as any, ALL, { columns: ["score"] as any }).compile()).toEqual({
      text: 'SELECT sum("score") AS result FROM "users"',
      values: []
    })
    expect(avg("users" as any, ALL, { columns: ["score"] as any }).compile()).toEqual({
      text: 'SELECT avg("score") AS result FROM "users"',
      values: []
    })
    expect(min("users" as any, ALL, { columns: ["score"] as any }).compile()).toEqual({
      text: 'SELECT min("score") AS result FROM "users"',
      values: []
    })
    expect(max("users" as any, ALL, { columns: ["score"] as any }).compile()).toEqual({
      text: 'SELECT max("score") AS result FROM "users"',
      values: []
    })
  })

  test("select rejects invalid sort direction and nulls placement", () => {
    expect(() =>
      select("users" as any, ALL, {
        order: [{ by: "id", direction: "UP" as any }]
      } as any)
    ).toThrow("Direction must be ASC/DESC, not 'UP'")

    expect(() =>
      select("users" as any, ALL, {
        order: [{ by: "id", direction: "ASC", nulls: "MIDDLE" as any }]
      } as any)
    ).toThrow("Nulls must be FIRST/LAST/undefined, not 'MIDDLE'")
  })
})

describe("bun db-shortcuts runResult transforms", () => {
  test("insert/upsert/update/deletes/select/selectOne/selectExactlyOne/count run correctly against pglite", async () => {
    const usersTable = fixture.usersTable as any
    const postsTable = fixture.postsTable as any

    const insertedUser = await insert(
      usersTable,
      { email: "carol@example.com", display_name: "Carol", role: "member" } as any
    ).run(fixture.bunSql)
    expect(insertedUser.email).toBe("carol@example.com")

    const insertedUsers = await insert(usersTable, [
      { email: "dave@example.com", display_name: "Dave", role: "member" },
      { email: "eve@example.com", display_name: "Eve", role: "member" }
    ] as any).run(fixture.bunSql)
    expect(insertedUsers).toHaveLength(2)

    const upserted = await upsert(
      usersTable,
      { email: "alice@example.com", display_name: "Alice Updated", role: "admin" } as any,
      "email" as any
    ).run(fixture.bunSql)
    expect(upserted.$action).toBe("UPDATE")
    expect(upserted.display_name).toBe("Alice Updated")

    const updatedUsers = await update(
      usersTable,
      { display_name: "Alice Final" } as any,
      { email: "alice@example.com" } as any
    ).run(fixture.bunSql)
    expect(updatedUsers).toHaveLength(1)
    expect(updatedUsers[0]?.display_name).toBe("Alice Final")

    const deletedPosts = await deletes(postsTable, { title: "Post 2" } as any).run(fixture.bunSql)
    expect(deletedPosts).toHaveLength(1)
    expect(deletedPosts[0]?.title).toBe("Post 2")

    const selectedUsers = await select(usersTable, ALL).run(fixture.bunSql)
    expect(selectedUsers.length).toBeGreaterThanOrEqual(4)

    const selectedOne = await selectOne(usersTable, { email: "alice@example.com" } as any).run(fixture.bunSql)
    expect(selectedOne?.email).toBe("alice@example.com")

    const selectedExactlyOne = await selectExactlyOne(usersTable, { email: "alice@example.com" } as any).run(fixture.bunSql)
    expect(selectedExactlyOne.email).toBe("alice@example.com")

    const counted = await count(usersTable, ALL).run(fixture.bunSql)
    expect(counted).toBeGreaterThanOrEqual(4)

    const summed = await sum(usersTable, ALL, { columns: ["id"] as any }).run(fixture.bunSql)
    const averaged = await avg(usersTable, ALL, { columns: ["id"] as any }).run(fixture.bunSql)
    const minimum = await min(usersTable, ALL, { columns: ["id"] as any }).run(fixture.bunSql)
    const maximum = await max(usersTable, ALL, { columns: ["id"] as any }).run(fixture.bunSql)

    expect(summed).toBeGreaterThan(0)
    expect(averaged).toBeGreaterThan(0)
    expect(minimum).toBe(1)
    expect(maximum).toBeGreaterThanOrEqual(minimum)

    const withLateral = await select(
      usersTable,
      ALL,
      {
        alias: "u",
        lateral: {
          post_count: count(postsTable, { user_id: parent("id") } as any)
        }
      } as any
    ).run(fixture.bunSql)

    expect(withLateral.length).toBeGreaterThan(0)
    expect(typeof withLateral[0]?.post_count).toBe("number")

    await truncate(postsTable, "RESTART IDENTITY", "CASCADE").run(fixture.bunSql)
    const postsAfterTruncate = await count(postsTable, ALL).run(fixture.bunSql)
    expect(postsAfterTruncate).toBe(0)
  })

  test("upsert single-row result can be undefined when conflict action is DO NOTHING", async () => {
    const result = await upsert(
      fixture.usersTable as any,
      { email: "alice@example.com", display_name: "Alice unchanged", role: "admin" } as any,
      "email" as any,
      { updateColumns: doNothing as any }
    ).run(fixture.bunSql)

    expect(result).toBeUndefined()
  })

  test("selectExactlyOne throws NotExactlyOneError when no result is returned", async () => {
    const query = selectExactlyOne(fixture.usersTable as any, { email: "nobody@example.com" } as any)

    await expect(query.run(fixture.bunSql)).rejects.toBeInstanceOf(NotExactlyOneError)
    await expect(query.run(fixture.bunSql)).rejects.toThrow(
      "One result expected but none returned (hint: check `.query.compile()` on this Error)"
    )
  })

  test("runtime lock query and noNullUpdateColumns branch execute as expected", async () => {
    await transaction(fixture.bunSql as any, IsolationLevel.Serializable, async transactionClient => {
      const locked = await select(fixture.usersTable as any, { id: 1 } as any, {
        lock: [{ for: "UPDATE" }]
      } as any).run(transactionClient)
      expect(locked[0]?.email).toBe("alice@example.com")

      const upserted = await upsert(
        fixture.usersTable as any,
        {
          email: "alice@example.com",
          display_name: "Alice no-null branch",
          role: "admin"
        } as any,
        "email" as any,
        {
          noNullUpdateColumns: ["display_name"] as any
        }
      ).run(transactionClient)

      expect(upserted.display_name).toBe("Alice no-null branch")
      expect(upserted.$action).toBe("UPDATE")
    })
  })

  test("runtime extras-returning insert branch returns computed fields", async () => {
    const inserted = await insert(
      fixture.usersTable as any,
      { email: "frank@example.com", display_name: "Frank", role: "member" } as any,
      {
        returning: ["email"] as any,
        extras: { upper_email: sql`upper(${"email"})` } as any
      }
    ).run(fixture.bunSql)

    expect(inserted.email).toBe("frank@example.com")
    expect(inserted.upper_email).toBe("FRANK@EXAMPLE.COM")
  })
})
