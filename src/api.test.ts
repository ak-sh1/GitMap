import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { importGithub, importZip, readFile } from "./api";
import type { Repository } from "./types";

afterEach(() => vi.restoreAllMocks());
async function zipFile(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return {
    name: "sample.zip",
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  } as File;
}
// JSZip's Node adapter expects raw bytes; wrap the browser File fixture at the boundary.
async function importFixture(file: File) {
  const load = JSZip.loadAsync.bind(JSZip);
  vi.spyOn(JSZip, "loadAsync").mockImplementation(async (input, options) =>
    load(input === file ? await file.arrayBuffer() : input, options),
  );
  return importZip(file);
}

describe("GitHub transport", () => {
  it("pins reads to the imported commit and removes credential paths", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            default_branch: "main",
            description: "Test",
            html_url: "https://github.com/a/b",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            commit: { sha: "abc123", commit: { tree: { sha: "def456" } } },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "def456",
            tree: [
              { path: "src/main.py", type: "blob", size: 20 },
              { path: ".env", type: "blob" },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('print("hello")'));
    const repo = await importGithub("https://github.com/a/b/tree/feature/one");
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api.github.com/repos/a/b/branches/feature%2Fone",
    );
    expect(fetcher.mock.calls[2][0]).toBe(
      "https://api.github.com/repos/a/b/git/trees/def456?recursive=1",
    );
    expect(repo.entries.map((e) => e.path)).toEqual(["src/main.py"]);
    await readFile(repo, repo.entries[0]);
    expect(fetcher.mock.calls[3][0]).toBe(
      "https://raw.githubusercontent.com/a/b/abc123/src/main.py",
    );
  });
  it("surfaces a rate limit instead of returning sample data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 403 }),
    );
    await expect(importGithub("a/b")).rejects.toThrow("limit");
  });
  it("reports truncated trees", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            commit: { sha: "commit", commit: { tree: { sha: "a" } } },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "a",
            truncated: true,
            tree: [{ path: "a.py", type: "blob" }],
          }),
        ),
      );
    expect((await importGithub("a/b")).warning).toContain("partial");
  });
});

describe("local archives", () => {
  it("strips one common root and excludes secrets and dependencies", async () => {
    const file = await zipFile({
      "project/src/app.py": "print(1)",
      "project/README.md": "# Sample",
      "project/.env": "SECRET=123",
      "project/node_modules/pkg/index.js": "junk",
    });
    const repo = await importFixture(file);
    expect(repo.source).toBe("zip");
    expect(repo.entries.map((e) => e.path).sort()).toEqual([
      "README.md",
      "src/app.py",
    ]);
    expect(repo.entries[0].content).toBe("print(1)");
  });
  it("rejects an archive with only unsupported files", async () => {
    const file = await zipFile({ "project/image.png": "binary" });
    await expect(importFixture(file)).rejects.toThrow("No supported");
  });
  it("omits source files larger than the preview limit", async () => {
    const file = await zipFile({
      "root/big.py": "x".repeat(400001),
      "root/small.py": "pass",
    });
    const repo = await importFixture(file);
    expect(repo.entries.map((e) => e.path)).toEqual(["small.py"]);
  });
});
