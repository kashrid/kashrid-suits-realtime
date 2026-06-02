import {
  ADMIN_ORDERS_ROOM,
  deliveryRoom,
  getSocketServer,
  orderRoom,
} from "@/lib/socket";

import { Router, type Request, type Response } from "express";
import { env } from "@/config/env";
import { z } from "zod";

export const internalOrderEventsRouter = Router();

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
});

const orderStatusUpdatedSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
  orderStatus: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  updatedAt: z.string().datetime().optional(),
});

const paymentSuccessSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
  paymentStatus: z.literal("paid"),
  updatedAt: z.string().datetime().optional(),
});

const deliveryTrackingSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
  status: z.string().min(1).max(100).optional(),
  driverId: z.string().min(1).max(128).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  message: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
});

function verifyInternalSecret(req: Request) {
  const secret = req.headers["x-socket-secret"];
  return secret === env.SOCKET_INTERNAL_SECRET;
}

function unauthorized(res: Response) {
  return res.status(401).json({
    ok: false,
    message: "Unauthorized",
  });
}

internalOrderEventsRouter.post("/internal/admin-new-order", (req, res) => {
  if (!verifyInternalSecret(req)) {
    return unauthorized(res);
  }

  const result = newPaidOrderSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      ok: false,
      message: "Invalid payload",
      issues: result.error.issues,
    });
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
    return res.status(400).json({
      ok: false,
      message: "Invalid payload",
      issues: result.error.issues,
    });
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
    return res.status(400).json({
      ok: false,
      message: "Invalid payload",
      issues: result.error.issues,
    });
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
      return res.status(400).json({
        ok: false,
        message: "Invalid payload",
        issues: result.error.issues,
      });
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
    return res.status(401).json({
      ok: false,
      message: "Unauthorized",
    });
  }

  const result = newPaidOrderSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      ok: false,
      message: "Invalid payload",
      issues: result.error.issues,
    });
  }

  const io = getSocketServer();

  io.to(ADMIN_ORDERS_ROOM).emit("admin:new-order", result.data);

  return res.json({
    ok: true,
  });
});
