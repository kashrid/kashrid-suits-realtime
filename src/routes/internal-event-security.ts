import { timingSafeEqual } from "crypto";
import { type Request, type Response } from "express";
import { env } from "@/config/env";
import { z } from "zod";

const INTERNAL_RATE_LIMIT_WINDOW_MS = 60_000;
const INTERNAL_RATE_LIMIT_MAX_REQUESTS = 120;
const internalRateLimitStore = new Map<
  string,
  { count: number; resetAt: number }
>();

// Compares internal shared secrets without timing leaks.
export function verifyInternalSecret(req: Request) {
  const secret = req.headers["x-socket-secret"];

  if (typeof secret !== "string") {
    return false;
  }

  const expectedBuffer = Buffer.from(env.SOCKET_INTERNAL_SECRET);
  const receivedBuffer = Buffer.from(secret);

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

// Sends a generic unauthorized response for failed internal auth.
export function unauthorized(res: Response) {
  return res.status(401).json({
    ok: false,
    message: "Unauthorized",
  });
}

// Prevents runaway internal event calls from one source.
export function rateLimitInternalEvents(req: Request, res: Response) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const current = internalRateLimitStore.get(key);

  for (const [storedKey, value] of internalRateLimitStore) {
    if (value.resetAt <= now) {
      internalRateLimitStore.delete(storedKey);
    }
  }

  if (!current || current.resetAt <= now) {
    internalRateLimitStore.set(key, {
      count: 1,
      resetAt: now + INTERNAL_RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  current.count += 1;

  if (current.count > INTERNAL_RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({
      ok: false,
      message: "Too many requests",
    });
    return false;
  }

  return true;
}

// Logs validation problems server-side without returning schema details.
export function invalidPayload(res: Response, error: z.ZodError) {
  console.warn("Invalid internal realtime event payload", error.issues);

  return res.status(400).json({
    ok: false,
    message: "Invalid payload",
  });
}
