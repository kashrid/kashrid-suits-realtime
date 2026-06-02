# Kashrid Realtime Server

Dedicated Socket.io server for Kashrid order notifications, order tracking,
payment updates, delivery tracking, and future driver events.

## Environment

```bash
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
SOCKET_INTERNAL_SECRET=replace-with-at-least-20-chars
```

`SOCKET_INTERNAL_SECRET` is used in two places:

- Internal REST calls from the Next.js app via `x-socket-secret`.
- HMAC-signed browser socket tokens created by the Next.js app.

## Run

```bash
bun install
bun run dev
```

## Rooms

- Admin order room: `admin:orders`
- Customer order room: `order:<orderPublicId>`
- Delivery room: `delivery:<orderPublicId>`

## Socket Authentication

Every browser socket connection must pass a short-lived token in
`socket.auth.token`. The token format is:

```txt
base64url(JSON payload).base64url(HMAC_SHA256(payload, SOCKET_INTERNAL_SECRET))
```

Payload:

```ts
{
  sub: string;
  role: "admin" | "customer" | "driver";
  orderPublicIds?: string[];
  exp: number;
}
```

Admin sockets automatically join `admin:orders`. Customer sockets may only join
order or delivery rooms listed in `orderPublicIds`.

## Browser Socket Events

Client emits:

- `join-order-room` with `{ orderPublicId }`
- `leave-order-room` with `{ orderPublicId }`
- `join-delivery-room` with `{ orderPublicId }`
- `leave-delivery-room` with `{ orderPublicId }`

Server emits:

- `admin:orders-room-joined`
- `order-room-joined` with `{ orderPublicId }`
- `delivery-room-joined` with `{ orderPublicId }`
- `admin:new-order`
- `customer:order-status-updated`
- `customer:payment-success`
- `customer:delivery-tracking-updated`
- `delivery:tracking-updated`
- `socket-error` with `{ message }`

## Internal REST Events

All internal endpoints require:

```txt
x-socket-secret: <SOCKET_INTERNAL_SECRET>
```

### New Paid Order

```http
POST /internal/admin-new-order
POST /internal/new-paid-order
```

Payload:

```ts
{
  orderPublicId: string;
  orderNumber: string;
  customerName: string;
  totalAmount: number;
  paymentMethod: "online" | "cod";
  paymentStatus: "paid";
  createdAt: string;
}
```

Emits `admin:new-order` to `admin:orders`.

### Order Status Updated

```http
POST /internal/order-status-updated
```

Payload:

```ts
{
  orderPublicId: string;
  orderStatus:
    | "pending"
    | "confirmed"
    | "preparing"
    | "out_for_delivery"
    | "delivered"
    | "cancelled";
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  updatedAt?: string;
}
```

Emits `customer:order-status-updated` to `order:<orderPublicId>`.

### Payment Success

```http
POST /internal/payment-success
```

Payload:

```ts
{
  orderPublicId: string;
  paymentStatus: "paid";
  updatedAt?: string;
}
```

Emits `customer:payment-success` to `order:<orderPublicId>`.

### Delivery Tracking Updated

```http
POST /internal/delivery-tracking-updated
```

Payload:

```ts
{
  orderPublicId: string;
  status?: string;
  driverId?: string;
  latitude?: number;
  longitude?: number;
  message?: string;
  updatedAt?: string;
}
```

Emits `customer:delivery-tracking-updated` to `order:<orderPublicId>` and
`delivery:tracking-updated` to `delivery:<orderPublicId>`.
