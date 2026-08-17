import type { ProteinBasis } from "../api/programs";

// Must mirror backend/engine/program.ts. Total-weight targets are the honest
// fallback when body fat is unknown; lean-mass targets use the higher range
// appropriate to resistance-trained people dieting in a deficit.
export const PROTEIN_LEVEL_GRAMS_PER_KG: Record<ProteinBasis, Record<"low" | "moderate" | "high" | "extra_high", number>> = {
  total: { low: 1.6, moderate: 1.8, high: 2.2, extra_high: 2.8 },
  lean: { low: 2.3, moderate: 2.6, high: 2.8, extra_high: 3.1 },
};
