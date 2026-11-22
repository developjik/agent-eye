import type { ChurnReport, GateResult, Verdict } from "../types.js";

export interface RunExpectationResult {
  kind: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface RunStepResult {
  index: number;
  name: string;
  action: string;
  target?: string;
  status: "passed" | "failed";
  tokens: number;
  durationMs: number;
  changedLines: number;
  ambiguous: number;
  falseSuccess: boolean;
  expectations: RunExpectationResult[];
  error?: string;
  candidates?: string[];
  finalUrl: string;
}

export interface RunReport {
  schemaVersion: 1;
  tool: { name: string; version: string };
  generatedAt: string;
  spec: { name: string; path?: string; baseUrl: string; steps: number };
  steps: RunStepResult[];
  totals: {
    steps: number;
    passed: number;
    failed: number;
    tokens: number;
    avgTokensPerStep: number;
    falseSuccess: number;
    ambiguousSteps: number;
  };
  churn: ChurnReport | null;
  gates: GateResult[];
  verdict: { status: Verdict; exitCode: number; summary: string };
}
