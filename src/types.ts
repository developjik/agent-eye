/** Shared report and measurement types for agent-eye. */

export type TokenizerName = "o200k_base" | "cl100k_base";

export type Verdict = "pass" | "warn" | "fail";

export interface ModeBill {
  /** Stable identifier, e.g. "raw-html". */
  mode: string;
  /** Human label, e.g. "raw HTML". */
  label: string;
  /** UTF-8 byte size of the payload an agent would receive. */
  bytes: number;
  /** Estimated token count (see `estimated`). */
  tokens: number;
  /** True when the number comes from an image-token formula or a sampled count. */
  estimated: boolean;
  /** Short explanation of how the payload was produced. */
  note?: string;
}

/** An interactive element as measured on the live page. */
export interface RawElement {
  ref: string;
  tag: string;
  role: string;
  name: string;
  nameSource: string | null;
  href: string | null;
  type: string | null;
  disabled: boolean;
  ariaHidden: boolean;
  hidden: boolean;
  zeroSize: boolean;
  /** Rendered but collapsed to under 2px (a "visually hidden" trap). */
  clipped: boolean;
  focusable: boolean;
  offscreen: boolean;
  occluded: boolean;
  occluder: string | null;
  inForm: boolean;
  shadow: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
  /** Resolved visible text, clipped. */
  text: string;
}

export interface ExtractResult {
  elements: RawElement[];
  totalInteractive: number;
  truncated: boolean;
  shadowRoots: number;
}

export interface NoiseItem {
  ref: string;
  role: string;
  tag: string;
  name: string;
  reason: string;
  detail?: string;
}

export interface DuplicateCluster {
  role: string;
  name: string;
  count: number;
  refs: string[];
}

export interface NoiseReport {
  /** Interactive elements counted in the whole page (before truncation). */
  interactive: number;
  /** How many were analyzed in detail. */
  analyzed: number;
  truncated: boolean;
  unnamed: { count: number; items: NoiseItem[] };
  duplicates: { count: number; elements: number; clusters: DuplicateCluster[] };
  hidden: { count: number; focusable: number; clipped: number; items: NoiseItem[] };
  offscreen: { count: number; items: NoiseItem[] };
  occluded: { count: number; inViewport: number; items: NoiseItem[] };
  frames: { count: number; interactive: number };
  shadow: { roots: number; interactive: number };
  /** Share of analyzed interactive elements that are noisy (see README for the exact rule). */
  noisePct: number;
  /** Share of analyzed interactive elements that share a (role, name) with another element. */
  ambiguousPct: number;
}

export interface ChurnSample {
  tMs: number;
  lines: number;
  changedVsPrevious: number;
  changedVsBaseline: number;
  /** Share of lines that differ from the very next sample, capped at 100. */
  changedPct: number;
  refsInvalidated: number;
  tokens: number;
}

export interface ChurnReport {
  durationMs: number;
  intervalMs: number;
  samples: ChurnSample[];
  lines: number;
  /** Share of idle samples that differed from the previous sample (instability frequency). */
  unstableSamplePct: number;
  /** Average share of lines that changed per sample (instability magnitude). */
  avgChangedPct: number;
  maxChangedPct: number;
  /** Share of interactive refs whose descriptor changed or disappeared between samples. */
  refInvalidationPct: number;
  tokensChurned: number;
  /** Lines that changed during the idle window; excluded when judging action effects. */
  volatileLines: string[];
  /** Specific regions (id / aria-live) that changed while idle; all their lines are excluded. */
  volatileZones: string[];
  stable: boolean;
  frozenAnimations: boolean;
}

export interface DeltaStep {
  from: string;
  to: string;
  linesBefore: number;
  linesAfter: number;
  added: number;
  removed: number;
  unchangedPct: number;
  fullTokens: number;
  deltaTokens: number;
  savingsPct: number;
}

export interface DeltaReport {
  steps: DeltaStep[];
  avgUnchangedPct: number;
  avgSavingsPct: number;
  note: string;
}

export type ActionVerdict = "effective" | "no-effect" | "blocked" | "error";

export interface ProbedControl {
  ref: string;
  role: string;
  name: string;
  verdict: ActionVerdict;
  urlChanged: boolean;
  linesChanged: number;
  networkRequests: number;
  consoleErrors: number;
  navigatedAway: boolean;
  error?: string;
}

export interface ActionTruthReport {
  attempted: number;
  effective: number;
  noEffect: number;
  blocked: number;
  errored: number;
  /** Destructive or unsafe controls the prober refused to touch. */
  skipped: number;
  falseSuccessPct: number | null;
  controls: ProbedControl[];
  /** Number of idle-volatile lines excluded from effect comparison. */
  volatileLines: number;
}

export interface Scorecard {
  tokensPerStep: number;
  noisePct: number;
  churnPct: number;
  churnMagnitudePct: number;
  deltaSavingsPct: number;
  falseSuccessPct: number | null;
  occluded: number;
  duplicateClusters: number;
  unnamed: number;
}

export interface GateResult {
  name: string;
  threshold: string;
  actual: string;
  passed: boolean;
}

export interface Finding {
  severity: "high" | "medium" | "low";
  title: string;
  evidence: string;
  fix: string;
}

export interface ProfileTarget {
  url: string;
  finalUrl: string;
  title: string;
  status: number | null;
  viewport: { width: number; height: number };
  bytes: number;
  screenshot?: {
    path: string;
    width: number;
    height: number;
    pngBytes: number;
    jpegBytes: number;
  };
}

export interface ProfileReport {
  schemaVersion: 1;
  tool: { name: string; version: string };
  generatedAt: string;
  target: ProfileTarget;
  tokenizer: { name: TokenizerName; label: string; note: string };
  bill: ModeBill[];
  interactiveText: string;
  noise: NoiseReport;
  churn: ChurnReport | null;
  delta: DeltaReport | null;
  actionTruth: ActionTruthReport | null;
  scorecard: Scorecard;
  gates: GateResult[];
  verdict: { status: Verdict; exitCode: number; summary: string; findings: Finding[] };
}

export interface PageSignature {
  lines: string[];
  /** Nearest stable region id per line (e.g. "#promo"), parallel to `lines`. */
  zones: string[];
  interactive: { ref: string; desc: string }[];
  truncated: boolean;
}

export interface CompactElementLine {
  ref: string;
  role: string;
  name: string;
}
