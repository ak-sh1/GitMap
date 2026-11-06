export type Entry = {
  path: string;
  type: "file" | "folder";
  size?: number;
  sha?: string;
  content?: string;
};
export type Repository = {
  id: string;
  name: string;
  owner: string;
  branch: string;
  description: string;
  source: "example" | "github" | "zip";
  entries: Entry[];
  sha?: string;
  url?: string;
  warning?: string;
};
export type TreeNode = Entry & { name: string; children: TreeNode[] };
export type Outline = {
  description: string;
  symbols: { name: string; kind: string; line: number }[];
  imports: string[];
  lines: number;
  language: string;
};
