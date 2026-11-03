import { randomUUID } from "node:crypto";

import { jwt } from "@elysiajs/jwt";
import { Elysia, t } from "elysia";

import db from "../db/db";
import { WEBROOT } from "../helpers/env";
import { isHtmlPageRequest } from "../helpers/isHtmlPageRequest";

export const userService = new Elysia({ name: "user/service" })
  .use(
    jwt({
      name: "jwt",
      schema: t.Object({
        id: t.String(),
      }),
      secret: process.env.JWT_SECRET ?? randomUUID(),
      exp: "7d",
    }),
  )
  .model({
    signIn: t.Object({
      email: t.String(),
      password: t.String(),
    }),
    session: t.Cookie({
      auth: t.String(),
      jobId: t.Optional(t.String()),
    }),
    optionalSession: t.Cookie({
      auth: t.Optional(t.String()),
      jobId: t.Optional(t.String()),
    }),
  })
  .macro("auth", {
    cookie: "optionalSession",
    async resolve({ request, set, status, jwt, cookie: { auth } }) {
      const unauthorized = () => {
        if (isHtmlPageRequest(request)) {
          set.headers.location = `${WEBROOT}/login`;
          return status(302, {
            success: false,
            message: "Redirecting to login",
          });
        }

        return status(401, {
          success: false,
          message: "Unauthorized",
        });
      };

      if (!auth.value) {
        return unauthorized();
      }
      const user = await jwt.verify(auth.value);
      if (!user) {
        auth.remove();
        return unauthorized();
      }
      // Disabled or expired (guest) accounts lose access immediately, not when their token runs out.
      try {
        const row = db.query("SELECT disabled, expires FROM users WHERE id = ?").get(user.id) as { disabled?: number; expires?: string | null } | null;
        if (row && (row.disabled || (row.expires && new Date(row.expires).getTime() < Date.now()))) {
          auth.remove();
          return unauthorized();
        }
      } catch {
        /* columns not migrated yet */
      }
      return {
        success: true,
        user,
      };
    },
  });
