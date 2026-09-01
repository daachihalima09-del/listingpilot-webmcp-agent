interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown>;
}

interface Document {
  readonly modelContext?: {
    registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal; exposedTo?: string[] }): Promise<undefined>;
    getTools(): Promise<Array<{ name: string }>>;
    addEventListener?(type: 'toolchange', listener: () => void): void;
    removeEventListener?(type: 'toolchange', listener: () => void): void;
  };
}
