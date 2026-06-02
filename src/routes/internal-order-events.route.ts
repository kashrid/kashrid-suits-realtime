import {
  ADMIN_ORDERS_ROOM,
  deliveryRoom,
  getSocketServer,
  orderRoom,
} from "@/lib/socket";

import { timingSafeEqual } from "crypto";
import { Router, type Request, type Response } from "express";
import { env } from "@/config/env";
import { z } from "zod";

export const internalOrderEventsRouter = Router();

const INTERNAL_RATE_LIMIT_WINDOW_MS = 60_000;
const INTERNAL_RATE_LIMIT_MAX_REQUESTS = 120;
const internalRateLimitStore = new Map<
  string,
  { count: number; resetAt: number }
>();

const paymentMethodSchema = z.enum(["online", "cod"]);
const paymentStatusSchema = z.enum(["pending", "paid", "failed", "refunded"]);
const orderStatusSchema = z.enum([
  "pending",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
]);

const newPaidOrderSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
  orderNumber: z.string().min(1).max(100),
  customerName: z.string().min(1).max(160),
  totalAmount: z.number().nonnegative(),
  paymentMethod: paymentMethodSchema,
  paymentStatus: z.literal("paid"),
  createdAt: z.string().datetime(),
}).strict();

const orderStatusUpdatedSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
  orderStatus: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  updatedAt: z.string().datetime().optional(),
}).strict();

const paymentSuccessSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
  paymentStatus: z.literal("paid"),
  updatedAt: z.string().datetime().optional(),
}).strict();

const deliveryTrackingSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
  status: z.string().min(1).max(100).optional(),
  driverId: z.string().min(1).max(128).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  message: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();

// Compares internal shared secrets without timing leaks.
function verifyInternalSecret(req: Request) {
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
function unauthorized(res: Response) {
  return res.status(401).json({
    ok: false,
    message: "Unauthorized",
  });
}

// Prevents runaway internal event calls from one source.
function rateLimitInternalEvents(req: Request, res: Response) {
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
function invalidPayload(res: Response, error: z.ZodError) {
  console.warn("Invalid internal realtime event payload", error.issues);

  return res.status(400).json({
    ok: false,
    message: "Invalid payload",
  });
}

internalOrderEventsRouter.use((req, res, next) => {
  if (!rateLimitInternalEvents(req, res)) {
    return;
  }

  next();
});

internalOrderEventsRouter.post("/internal/admin-new-order", (req, res) => {
  if (!verifyInternalSecret(req)) {
    return unauthorized(res);
  }

  const result = newPaidOrderSchema.safeParse(req.body);

  if (!result.success) {
    return invalidPayload(res, result.error);
  }

  const io = getSocketServer();

  io.to(ADMIN_ORDERS_ROOM).emit("admin:new-order", result.data);

  return res.json({
    ok: true,
  });
});

internalOrderEventsRouter.post("/internal/order-status-updated", (req, res) => {
  if (!verifyInternalSecret(req)) {
    return unauthorized(res);
  }

  const result = orderStatusUpdatedSchema.safeParse(req.body);

  if (!result.success) {
    return invalidPayload(res, result.error);
  }

  const payload = {
    ...result.data,
    updatedAt: result.data.updatedAt ?? new Date().toISOString(),
  };
  const io = getSocketServer();

  io.to(orderRoom(payload.orderPublicId)).emit(
    "customer:order-status-updated",
    payload,
  );

  return res.json({
    ok: true,
  });
});

internalOrderEventsRouter.post("/internal/payment-success", (req, res) => {
  if (!verifyInternalSecret(req)) {
    return unauthorized(res);
  }

  const result = paymentSuccessSchema.safeParse(req.body);

  if (!result.success) {
    return invalidPayload(res, result.error);
  }

  const payload = {
    ...result.data,
    updatedAt: result.data.updatedAt ?? new Date().toISOString(),
  };
  const io = getSocketServer();

  io.to(orderRoom(payload.orderPublicId)).emit(
    "customer:payment-success",
    payload,
  );

  return res.json({
    ok: true,
  });
});

internalOrderEventsRouter.post(
  "/internal/delivery-tracking-updated",
  (req, res) => {
    if (!verifyInternalSecret(req)) {
      return unauthorized(res);
    }

    const result = deliveryTrackingSchema.safeParse(req.body);

    if (!result.success) {
      return invalidPayload(res, result.error);
    }

    const payload = {
      ...result.data,
      updatedAt: result.data.updatedAt ?? new Date().toISOString(),
    };
    const io = getSocketServer();

    io.to(orderRoom(payload.orderPublicId)).emit(
      "customer:delivery-tracking-updated",
      payload,
    );
    io.to(deliveryRoom(payload.orderPublicId)).emit(
      "delivery:tracking-updated",
      payload,
    );

    return res.json({
      ok: true,
    });
  },
);

internalOrderEventsRouter.post("/internal/new-paid-order", (req, res) => {
  if (!verifyInternalSecret(req)) {
    return unauthorized(res);
  }

  const result = newPaidOrderSchema.safeParse(req.body);

  if (!result.success) {
    return invalidPayload(res, result.error);
  }

  const io = getSocketServer();

  io.to(ADMIN_ORDERS_ROOM).emit("admin:new-order", result.data);

  return res.json({
    ok: true,
  });
});
