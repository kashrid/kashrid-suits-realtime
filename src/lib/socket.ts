import type { Server } from "socket.io";

let io: Server | null = null;

export const ADMIN_ORDERS_ROOM = "admin:orders";

export function setSocketServer(server: Server) {
  io = server;
}

export function getSocketServer() {
  if (!io) {
    throw new Error("Socket server not initialized");
  }

  return io;
}

export function orderRoom(orderPublicId: string) {
  return `order:${orderPublicId}`;
}

export function deliveryRoom(orderPublicId: string) {
  return `delivery:${orderPublicId}`;
}
