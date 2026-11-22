import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const TargetShape = z
  .object({
    role: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    nth: z.number().int().min(0).optional(),
  })
  .refine((target) => !!(target.role || target.name || target.selector || target.text), {
    message: "target needs at least one of role, name, selector, text",
  });

const ElementQueryShape = z.object({
  role: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
});

const ExpectShape = z
  .object({
    urlContains: z.string().min(1).optional(),
    urlEquals: z.string().min(1).optional(),
    textContains: z.string().min(1).optional(),
    textAbsent: z.string().min(1).optional(),
    elementExists: ElementQueryShape.optional(),
    elementAbsent: ElementQueryShape.optional(),
    countAtLeast: z.object({ selector: z.string().min(1), n: z.number().int().min(0) }).optional(),
    changed: z.boolean().optional(),
    ariaChanged: z.boolean().optional(),
  })
  .refine((expect) => Object.values(expect).some((value) => value !== undefined), {
    message: "expectation is empty",
  });

export const StepSchema = z
  .object({
    name: z.string().optional(),
    do: z.enum(["goto", "click", "fill", "press", "wait", "assert", "snapshot"]).optional(),
    url: z.string().optional(),
    target: TargetShape.optional(),
    value: z.string().optional(),
    key: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    expect: z.array(ExpectShape).optional(),
  })
  .superRefine((step, ctx) => {
    const action = actionOf(step);
    if (action === "goto" && !step.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "goto needs `url`" });
    }
    if ((action === "click" || action === "fill" || action === "press") && !step.target) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${action} needs a \`target\`` });
    }
    if (action === "fill" && step.value === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "fill needs a `value`" });
    }
    if (action === "press" && !step.key) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "press needs a `key` (e.g. Enter)" });
    }
  });

export const BudgetSchema = z.object({
  tokensPerStep: z.number().positive().optional(),
  maxFalseSuccess: z.number().min(0).max(100).optional(),
  maxChurnPct: z.number().min(0).max(100).optional(),
  maxNoisePct: z.number().min(0).max(100).optional(),
});

export const SpecSchema = z.object({
  name: z.string().optional(),
  url: z.string().optional(),
  budget: BudgetSchema.optional(),
  steps: z.array(StepSchema).min(1, "at least one step is required"),
});

export type RunTarget = z.infer<typeof TargetShape>;
export type RunExpectation = z.infer<typeof ExpectShape>;
export type RunStep = z.infer<typeof StepSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type RunSpec = z.infer<typeof SpecSchema>;
export type RunAction = "goto" | "click" | "fill" | "press" | "wait" | "assert" | "snapshot";

/** Action is explicit (`do`) or inferred from the fields present. */
export function actionOf(step: Pick<RunStep, "do" | "url" | "target" | "value">): RunAction {
  if (step.do) return step.do;
  if (step.url) return "goto";
  if (step.target && step.value !== undefined) return "fill";
  if (step.target) return "click";
  return "assert";
}

export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecError";
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  ${path}: ${issue.message}`;
    })
    .join("\n");
}

export function parseSpecObject(raw: unknown, name?: string): RunSpec {
  const parsed = SpecSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SpecError(`invalid acceptance spec:\n${formatZodError(parsed.error)}`);
  }
  return { ...parsed.data, name: parsed.data.name ?? name ?? "acceptance run" };
}

export function loadSpec(path: string): RunSpec {
  const source = readFileSync(path, "utf8");
  let document: unknown;
  try {
    document = extname(path).toLowerCase() === ".json" ? JSON.parse(source) : parseYaml(source);
  } catch (error) {
    throw new SpecError(`could not parse ${path}: ${(error as Error).message}`);
  }
  return parseSpecObject(document, path.split("/").pop()?.replace(/\.(ya?ml|json)$/i, ""));
}
