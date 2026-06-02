import {
  ADMIN_ORDERS_ROOM,
  deliveryRoom,
  orderRoom,
  setSocketServer,
} from "@/lib/socket";
import { verifyRealtimeToken } from "@/lib/realtime-auth";

import { Server } from "socket.io";
import cors from "cors";
import { createServer } from "http";
import { env } from "@/config/env";
import express from "express";
import { healthRouter } from "@/routes/health.route";
import helmet from "helmet";
import { internalOrderEventsRouter } from "@/routes/internal-order-events.route";
import { z } from "zod";

const app = express();

const allowedOrigins = new Set(env.FRONTEND_ORIGINS);

// Allows configured frontend origins while still permitting non-browser HTTP clients.
function isAllowedHttpOrigin(origin?: string) {
  return !origin || allowedOrigins.has(origin);
}

// Requires browser socket handshakes to come from a configured frontend origin.
function isAllowedSocketOrigin(origin?: string) {
  return Boolean(origin && allowedOrigins.has(origin));
}

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedHttpOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed"));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "20kb" }));

app.use(healthRouter);
app.use(internalOrderEventsRouter);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      if (isAllowedSocketOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed"), false);
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 10_000,
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

setSocketServer(io);

const joinOrderRoomSchema = z.object({
  orderPublicId: z.string().min(6).max(100),
});

io.use((socket, next) => {
  try {
    if (!isAllowedSocketOrigin(socket.handshake.headers.origin)) {
      next(new Error("Unauthorized origin"));
      return;
    }

    socket.data.realtimeUser = verifyRealtimeToken(socket.handshake.auth?.token);
    next();
  } catch (error) {
    console.warn("Socket authentication failed", {
      socketId: socket.id,
      reason: error instanceof Error ? error.message : "Unknown error",
    });
    next(new Error("Unauthorized socket"));
  }
});

io.on("connection", (socket) => {
  const realtimeUser = socket.data.realtimeUser as ReturnType<
    typeof verifyRealtimeToken
  >;

  if (realtimeUser.role === "admin") {
    socket.join(ADMIN_ORDERS_ROOM);
    socket.emit("admin:orders-room-joined");
  }

  socket.on("join-order-room", (payload) => {
    const result = joinOrderRoomSchema.safeParse(payload);

    if (!result.success) {
      socket.emit("socket-error", {
        message: "Invalid order room request",
      });
      return;
    }

    const canJoinOrderRoom =
      realtimeUser.role === "admin" ||
      realtimeUser.orderPublicIds.includes(result.data.orderPublicId);

    if (!canJoinOrderRoom) {
      socket.emit("socket-error", {
        message: "Unauthorized order room request",
      });
      return;
    }

    socket.join(orderRoom(result.data.orderPublicId));

    socket.emit("order-room-joined", {
      orderPublicId: result.data.orderPublicId,
    });
  });

  socket.on("leave-order-room", (payload) => {
    const result = joinOrderRoomSchema.safeParse(payload);

    if (!result.success) return;

    socket.leave(orderRoom(result.data.orderPublicId));
  });

  socket.on("join-delivery-room", (payload) => {
    const result = joinOrderRoomSchema.safeParse(payload);

    if (!result.success) {
      socket.emit("socket-error", {
        message: "Invalid delivery room request",
      });
      return;
    }

    const canJoinDeliveryRoom =
      realtimeUser.role === "admin" ||
      (realtimeUser.role === "driver" &&
        realtimeUser.orderPublicIds.includes(result.data.orderPublicId)) ||
      realtimeUser.orderPublicIds.includes(result.data.orderPublicId);

    if (!canJoinDeliveryRoom) {
      socket.emit("socket-error", {
        message: "Unauthorized delivery room request",
      });
      return;
    }

    socket.join(deliveryRoom(result.data.orderPublicId));

    socket.emit("delivery-room-joined", {
      orderPublicId: result.data.orderPublicId,
    });
  });

  socket.on("leave-delivery-room", (payload) => {
    const result = joinOrderRoomSchema.safeParse(payload);

    if (!result.success) return;

    socket.leave(deliveryRoom(result.data.orderPublicId));
  });
});

httpServer.listen(env.PORT, "0.0.0.0", () => {
  console.log(`Realtime server running on http://localhost:${env.PORT}`);
});
