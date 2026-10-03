import { z } from "zod";

// ---------------------------------------------------------------------------
// Step option schemas
// ---------------------------------------------------------------------------

const stepExpectSchema = z
  .object({
    status: z.number().int().min(100).max(599).optional(),
    body_includes: z.string().optional(),
    max_duration_ms: z.number().nonnegative().optional(),
    error: z.enum(["TIMEOUT", "NETWORK_ERROR"]).optional(),
  })
  .strict()
  .refine(
    (expect) =>
      !(expect.error && (expect.status !== undefined || expect.body_includes !== undefined)),
    { message: "Transport-error expectations cannot include HTTP response assertions." },
  )
  .optional();

const stepOptionsSchema = z
  .object({
    duplicate: z.boolean().optional(),
    invalid_signature: z.boolean().optional(),
    missing_signature: z.boolean().optional(),
    remove_fields: z.array(z.string().min(1)).optional(),
    set_fields: z.record(z.string(), z.unknown()).optional(),
    malformed_body: z.boolean().optional(),
  })
  .strict()
  .refine((options) => !(options.invalid_signature && options.missing_signature), {
    message: "Choose either invalid_signature or missing_signature, not both.",
  })
  .optional();

// ---------------------------------------------------------------------------
// Step schemas
// ---------------------------------------------------------------------------

const eventStepSchema = z
  .object({
    event: z.string().min(1),
    product: z.string().min(1).optional(),
    options: stepOptionsSchema,
    expect: stepExpectSchema,
  })
  .strict();

const waitStepSchema = z
  .object({
    wait: z.number().int().min(0).max(60_000),
  })
  .strict();

const stepSchema = z.union([eventStepSchema, waitStepSchema]);

// ---------------------------------------------------------------------------
// Deterministic config
// ---------------------------------------------------------------------------

const deterministicSchema = z
  .object({
    seed: z.string().min(1).optional(),
    timestamp: z.string().min(1).optional(),
  })
  .strict()
  .optional();

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

const variablesSchema = z
  .object({
    order_id: z.string().min(1).max(50).optional(),
    transaction_id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
    amount: z.number().int().positive().optional(),
    product: z.string().min(1).optional(),
  })
  .strict()
  .optional();

// ---------------------------------------------------------------------------
// Top-level scenario schema
// ---------------------------------------------------------------------------

export const scenarioFileSchema = z
  .object({
    version: z.literal(1),
    provider: z.string().min(1),
    target: z.string().url(),
    variables: variablesSchema,
    deterministic: deterministicSchema,
    steps: z.array(stepSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (scenario) => {
      let totalWaitMs = 0;
      for (const step of scenario.steps) {
        if ("wait" in step) totalWaitMs += step.wait;
      }
      return totalWaitMs <= 300_000;
    },
    { message: "Total wait time must not exceed 300000 ms." },
  );

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ScenarioFile = z.infer<typeof scenarioFileSchema>;
export type ScenarioStep = z.infer<typeof stepSchema>;
export type EventStep = z.infer<typeof eventStepSchema>;
export type WaitStep = z.infer<typeof waitStepSchema>;
export type StepExpect = z.infer<typeof stepExpectSchema>;
export type StepOptions = z.infer<typeof stepOptionsSchema>;
export type DeterministicConfig = z.infer<typeof deterministicSchema>;
export type ScenarioVariables = z.infer<typeof variablesSchema>;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isEventStep(step: ScenarioStep): step is EventStep {
  return "event" in step;
}

export function isWaitStep(step: ScenarioStep): step is WaitStep {
  return "wait" in step;
}
