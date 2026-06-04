import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().url()).min(1))
    .transform((origins) => origins.map((origin) => new URL(origin).origin)),
  SOCKET_INTERNAL_SECRET: z.string().min(32),
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  FRONTEND_ORIGINS: parsedEnv.FRONTEND_ORIGIN,
  FRONTEND_ORIGIN: parsedEnv.FRONTEND_ORIGIN[0],
};
