import { describe, it, expect } from "vitest";
import {
  analyzeFile,
  buildTree,
  includePath,
  parseRepository,
  relatedFiles,
} from "./core";

describe("repository input", () => {
  it("accepts an HTTPS repository or a short name", () => {
    expect(parseRepository("https://github.com/pallets/flask.git")).toEqual({
      owner: "pallets",
      name: "flask",
      branch: undefined,
    });
    expect(parseRepository("pallets/flask")).toEqual({
      owner: "pallets",
      name: "flask",
      branch: undefined,
    });
  });
  it("preserves a branch containing slashes", () =>
    expect(
      parseRepository("https://github.com/a/b/tree/feature/example").branch,
    ).toBe("feature/example"));
  it.each([
    "http://github.com/a/b",
    "https://github.com.evil.example/a/b",
    "https://user:pass@github.com/a/b",
    "https://github.com:8443/a/b",
    "../repo",
    "https://github.com/a/b/blob/main/x.py",
  ])("rejects %s", (input) => expect(() => parseRepository(input)).toThrow());
});
describe("tree indexing", () => {
  it("creates implicit directories and sorts folders before files", () => {
    const tree = buildTree([
      { path: "z.txt", type: "file" },
      { path: "src/main.py", type: "file" },
      { path: "a.txt", type: "file" },
      { path: "src", type: "folder" },
    ]);
    expect(tree.children.map((n) => n.name)).toEqual(["src", "a.txt", "z.txt"]);
    expect(tree.children[0].children.map((n) => n.name)).toEqual(["main.py"]);
  });
  it.each([
    "node_modules/x.js",
    ".env",
    "src/.env.local",
    "../secret.txt",
    "/etc/passwd",
    "src/credentials.json",
    "foo/key.pem",
  ])("excludes %s", (path) => expect(includePath(path)).toBe(false));
  it("does not filter unrelated names", () =>
    expect(includePath("src/building.py")).toBe(true));
});
describe("source analysis", () => {
  it("extracts Python docstrings, imports, and declaration lines", () => {
    const result = analyzeFile(
      "books.py",
      '"""Store books."""\nfrom app.models import Book\n\nclass Service:\n    async def save(self):\n        pass\n',
    );
    expect(result.description).toBe("Store books.");
    expect(result.imports).toEqual(["app.models"]);
    expect(result.symbols).toEqual([
      { name: "Service", kind: "class", line: 4 },
      { name: "save", kind: "function", line: 5 },
    ]);
  });
  it("extracts TypeScript functions and relative imports", () => {
    const result = analyzeFile(
      "src/index.ts",
      "import {x} from './util';\nexport const build = () => x;\nexport interface User {}\n",
    );
    expect(result.imports).toEqual(["./util"]);
    expect(result.symbols.map((s) => s.name)).toEqual(["build", "User"]);
  });
  it("resolves relative imports without matching similarly named files", () => {
    const entries = [
      { path: "src/util.ts", type: "file" as const },
      { path: "src/utility.ts", type: "file" as const },
    ];
    expect(
      relatedFiles("src/main.ts", ["./util"], entries).map((e) => e.path),
    ).toEqual(["src/util.ts"]);
  });
});
