/**
 * Tools Slice 1 depends on. Deliberately narrow: adding a name here means
 * Atelier refuses to run without it, so only list genuine hard requirements.
 */
export const REQUIRED_PAPER_TOOLS = [
  "get_basic_info",
  "get_guide",
  "get_tokens",
  "create_tokens",
  "get_screenshot",
  "get_computed_styles",
  "find_nodes",
  "list_comment_threads",
  "set_comment_thread_status",
] as const;

export interface PaperCapabilities {
  readonly tools: ReadonlySet<string>;
  has(name: string): boolean;
  missing(): string[];
}

export function probeCapabilities(toolNames: readonly string[]): PaperCapabilities {
  const tools = new Set(toolNames);
  return {
    tools,
    has: (name) => tools.has(name),
    missing: () => REQUIRED_PAPER_TOOLS.filter((n) => !tools.has(n)),
  };
}
