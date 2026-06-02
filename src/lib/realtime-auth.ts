import { createHmac, timingSafeEqual } from "crypto";

import { env } from "@/config/env";
import { z } from "zod";

const MAX_TOKEN_TTL_SECONDS = 60 * 10;

export const realtimeRoleSchema = z.enum(["admin", "customer", "driver"]);

export const realtimeTokenPayloadSchema = z.object({
  sub: z.string().min(1).max(128),
  role: realtimeRoleSchema,
  orderPublicIds: z.array(z.string().min(6).max(100)).max(100).default([]),
  iat: z.number().int().positive().optional(),
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

// Parses and validates the encoded token payload without leaking parse errors.
function parseRealtimeTokenPayload(encodedPayload: string) {
  try {
    return realtimeTokenPayloadSchema.parse(
      JSON.parse(base64UrlDecode(encodedPayload)),
    );
  } catch {
    throw new Error("Invalid realtime token payload");
  }
}

export function createRealtimeToken(payload: RealtimeTokenPayload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

// Verifies a short-lived HMAC token issued by the trusted Next.js app.
export function verifyRealtimeToken(token: unknown) {
  if (typeof token !== "string") {
    throw new Error("Missing realtime token");
  }

  if (token.length > 4096) {
    throw new Error("Realtime token is too large");
  }

  const tokenParts = token.split(".");

  if (tokenParts.length !== 2) {
    throw new Error("Invalid realtime token");
  }

  const [encodedPayload, receivedSignature] = tokenParts;

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

  const payload = parseRealtimeTokenPayload(encodedPayload);
  const now = Date.now();

  if (payload.exp * 1000 < now) {
    throw new Error("Realtime token expired");
  }

  if (payload.iat && payload.iat * 1000 > now + 30_000) {
    throw new Error("Realtime token issued in the future");
  }

  if (payload.iat && payload.exp - payload.iat > MAX_TOKEN_TTL_SECONDS) {
    throw new Error("Realtime token lifetime is too long");
  }

  return payload;
}
