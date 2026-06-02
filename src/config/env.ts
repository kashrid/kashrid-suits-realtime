import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().url(),
  SOCKET_INTERNAL_SECRET: z.string().min(20),
});

export const env = envSchema.parse(process.env);