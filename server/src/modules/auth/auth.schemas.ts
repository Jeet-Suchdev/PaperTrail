import { z } from 'zod';

// Register enforces the full password policy — this is the only place a
// policy belongs. Login deliberately does NOT (max length only): a min-10
// check here would tell an attacker which passwords meet our policy.
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(64),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
