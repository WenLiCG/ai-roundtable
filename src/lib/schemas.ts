import { z } from "zod";
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_TIMEOUT_MS,
  MAX_ROUNDS_LIMIT,
} from "@/lib/constants";

export const modelCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url(),
  apiKey: z.string().min(1),
  model: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  timeoutMs: z.coerce.number().int().min(5_000).max(600_000).default(DEFAULT_TIMEOUT_MS),
  maxInputChars: z.coerce.number().int().min(1_000).max(1_000_000).nullable().optional(),
});

export const modelUpdateSchema = modelCreateSchema
  .partial()
  .extend({
    apiKey: z.string().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  });

export const runDiscussionSchema = z.object({
  question: z.string().trim().min(1).max(100_000),
  modelIds: z.array(z.string().min(1)).min(1),
  executionMode: z.enum(["concurrent", "sequential"]).default("concurrent"),
  maxRounds: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ROUNDS_LIMIT)
    .default(DEFAULT_MAX_ROUNDS),
  promptTemplate: z.string().trim().min(1).max(20_000).default(DEFAULT_PROMPT_TEMPLATE),
});

export const exportFormatSchema = z.enum(["md", "json"]).default("md");

export const loginSchema = z.object({
  password: z.string().min(1).max(200),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export type RunDiscussionInput = z.infer<typeof runDiscussionSchema>;
