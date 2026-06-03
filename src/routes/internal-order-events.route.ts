import {
  ADMIN_ORDERS_ROOM,
  getSocketServer,
  orderRoom,
} from "@/lib/socket";
import {
  invalidPayload,
  rateLimitInternalEvents,
  unauthorized,
  verifyInternalSecret,
} from "@/routes/internal-event-security";

import { Router } from "express";
import { z } from "zod";

export const internalOrderEventsRouter = Router();

const paymentMethodSchema = z.enum(["online", "cod"]);
const paymentStatusSchema = z.enum(["pending", "paid", "failed", "refunded"]);
const orderStatusSchema = z.enum([
  "pending",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "assigned_to_driver",
  "picked_up",
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
