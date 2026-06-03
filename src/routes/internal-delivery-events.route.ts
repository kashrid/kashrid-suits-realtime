import {
  ADMIN_ORDERS_ROOM,
  deliveryRoom,
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

export const internalDeliveryEventsRouter = Router();

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

const deliveryTrackingSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
  status: z.string().min(1).max(100).optional(),
  driverId: z.string().min(1).max(128).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  message: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();

const deliveryStatusPayloadSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
  orderStatus: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  deliveryProvider: z.literal("pidge"),
  deliveryStatus: z.string().min(1).max(100),
  riderName: z.string().min(1).max(160).optional(),
  riderPhone: z.string().min(1).max(32).optional(),
  trackingUrl: z.string().url().optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();

// Emits a delivery status change to admin, customer order, and delivery rooms.
function emitDeliveryStatusUpdate({
  adminEvent,
  payload,
}: {
  adminEvent: "admin:delivery-assigned" | "admin:delivery-status-updated";
  payload: z.infer<typeof deliveryStatusPayloadSchema> & { updatedAt: string };
}) {
  const io = getSocketServer();

  io.to(ADMIN_ORDERS_ROOM).emit(adminEvent, payload);
  io.to(orderRoom(payload.orderPublicId)).emit(
    "customer:order-status-updated",
    {
      orderPublicId: payload.orderPublicId,
      orderStatus: payload.orderStatus,
      paymentStatus: payload.paymentStatus,
      updatedAt: payload.updatedAt,
    },
  );
  io.to(orderRoom(payload.orderPublicId)).emit(
    "customer:delivery-status-updated",
    payload,
  );
  io.to(deliveryRoom(payload.orderPublicId)).emit(
    "delivery:tracking-updated",
    payload,
  );
}

// Applies shared rate limiting before any internal delivery event is handled.
internalDeliveryEventsRouter.use((req, res, next) => {
  if (!rateLimitInternalEvents(req, res)) {
    return;
  }

  next();
});

// Broadcasts generic delivery tracking updates from trusted server calls.
internalDeliveryEventsRouter.post(
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

// Broadcasts the first successful rider assignment for a Pidge delivery.
internalDeliveryEventsRouter.post("/internal/delivery-assigned", (req, res) => {
  if (!verifyInternalSecret(req)) {
    return unauthorized(res);
  }

  const result = deliveryStatusPayloadSchema.safeParse(req.body);

  if (!result.success) {
    return invalidPayload(res, result.error);
  }

  emitDeliveryStatusUpdate({
    adminEvent: "admin:delivery-assigned",
    payload: {
      ...result.data,
      updatedAt: result.data.updatedAt ?? new Date().toISOString(),
    },
  });

  return res.json({
    ok: true,
  });
});

// Broadcasts delivery lifecycle updates after Pidge webhooks update the database.
internalDeliveryEventsRouter.post(
  "/internal/delivery-status-updated",
  (req, res) => {
    if (!verifyInternalSecret(req)) {
      return unauthorized(res);
    }

    const result = deliveryStatusPayloadSchema.safeParse(req.body);

    if (!result.success) {
      return invalidPayload(res, result.error);
    }

    emitDeliveryStatusUpdate({
      adminEvent: "admin:delivery-status-updated",
      payload: {
        ...result.data,
        updatedAt: result.data.updatedAt ?? new Date().toISOString(),
      },
    });

    return res.json({
      ok: true,
    });
  },
);
