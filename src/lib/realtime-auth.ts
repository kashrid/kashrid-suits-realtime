import { createHmac, timingSafeEqual } from "crypto";

import { env } from "@/config/env";
import { z } from "zod";

export const realtimeRoleSchema = z.enum(["admin", "customer", "driver"]);

export const realtimeTokenPayloadSchema = z.object({
  sub: z.string().min(1).max(128),
  role: realtimeRoleSchema,
  orderPublicIds: z.array(z.string().min(6).max(100)).default([]),
  exp: z.number().int().positive(),
});

export type RealtimeTokenPayload = z.infer<typeof realtimeTokenPayloadSchema>;

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(encodedPayload: string) {
  return createHmac("sha256", env.SOCKET_INTERNAL_SECRET)
    .update(encodedPayload)
    .digest("base64url");
}

export function createRealtimeToken(payload: RealtimeTokenPayload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyRealtimeToken(token: unknown) {
  if (typeof token !== "string") {
    throw new Error("Missing realtime token");
  }

  const [encodedPayload, receivedSignature] = token.split(".");

  if (!encodedPayload || !receivedSignature) {
    throw new Error("Invalid realtime token");
  }

  const expectedSignature = sign(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(receivedSignature);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new Error("Invalid realtime token signature");
  }

  const payload = realtimeTokenPayloadSchema.parse(
    JSON.parse(base64UrlDecode(encodedPayload)),
  );

  if (payload.exp * 1000 < Date.now()) {
    throw new Error("Realtime token expired");
  }

  return payload;
}
