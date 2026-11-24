import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getPool } from "../src/lib/db";
import { runIdempotentMutation } from "../src/lib/idempotency";
import type { SessionUser } from "../src/lib/types";

describe("client mutation ledger", () => {
  it("returns the original result on replay and rejects changed content", async () => {
    const client = await getPool("dev").connect();
    await client.query("BEGIN");
    try {
      const userResult = await client.query<{
        user_id: number;
        username: string;
        full_name: string;
        role: SessionUser["role"];
      }>(
        `SELECT user_id, username, full_name, role::text AS role
         FROM erp.app_users
         WHERE username = 'vendedor1'`
      );
      const row = userResult.rows[0];
      const actor: SessionUser = {
        userId: Number(row.user_id),
        username: row.username,
        fullName: row.full_name,
        role: row.role,
        defaultCashAccountId: null,
      };
      const mutationId = crypto.randomUUID();
      const request = new NextRequest("http://localhost/api/orders", {
        method: "POST",
        headers: {
          "Idempotency-Key": mutationId,
          "X-BHT-Offline-Actor": actor.username,
        },
      });
      let executions = 0;
      const execute = async () => ({ orderCode: `TEST-${++executions}` });

      const first = await runIdempotentMutation(
        client,
        request,
        actor,
        "orders:create",
        { amount: 10 },
        execute
      );
      const replay = await runIdempotentMutation(
        client,
        request,
        actor,
        "orders:create",
        { amount: 10 },
        execute
      );

      expect(first).toEqual({ orderCode: "TEST-1" });
      expect(replay).toEqual(first);
      expect(executions).toBe(1);
      await expect(
        runIdempotentMutation(
          client,
          request,
          actor,
          "orders:create",
          { amount: 11 },
          execute
        )
      ).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_REUSED",
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
