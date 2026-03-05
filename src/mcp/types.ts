export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
}

export interface ErrorResult extends ToolResult {
  isError: true;
}
