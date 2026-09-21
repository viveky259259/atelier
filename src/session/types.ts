export type Stage =
  | "DISCOVERY"
  | "DIRECTION"
  | "SYSTEM"
  | "MATERIALIZE"
  | "CRITIQUE"
  | "CONVERGED";

export const STAGE_ORDER: readonly Stage[] = [
  "DISCOVERY",
  "DIRECTION",
  "SYSTEM",
  "MATERIALIZE",
  "CRITIQUE",
  "CONVERGED",
] as const;

export interface Session {
  id: string;
  paperFileId: string;
  stage: Stage;
  brief: string;
  createdAt: string;
  updatedAt: string;
}
