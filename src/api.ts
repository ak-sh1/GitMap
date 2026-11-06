import type { Entry, Repository } from "./types";
import { includePath, parseRepository, textFile } from "./core";

const API = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const USE_API = Boolean(import.meta.env.VITE_API_BASE_URL);
const MAX_FILE = 400_000;
async function checked(response: Response) {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 403 || response.status === 429)
      throw new Error(
        "GitHub’s request limit was reached. Try again later, or upload a repository ZIP.",
      );
    if (response.status === 404)
      throw new Error(
        "Repository or branch not found. Check the URL and make sure it is public.",
      );
    throw new Error(
      data?.error?.message ||
        data?.error ||
        data?.message ||
        `Request failed (${response.status}).`,
    );
  }
  return response;
}
export async function importGithub(
  input: string,
  signal?: AbortSignal,
): Promise<Repository> {
  const { owner, name, branch } = parseRepository(input);
  if (USE_API)
    return (
      await checked(
        await fetch(`${API}/api/repositories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: input }),
          signal,
        }),
      )
    ).json();
  const endpoint = `https://api.github.com/repos/${owner}/${name}`;
  const meta = await (await checked(await fetch(endpoint, { signal }))).json();
  const selectedBranch = branch || meta.default_branch;
  const snapshot = await (
    await checked(
      await fetch(
        `${endpoint}/branches/${encodeURIComponent(selectedBranch)}`,
        { signal },
      ),
    )
  ).json();
  const commitSha = snapshot.commit?.sha;
  const treeSha = snapshot.commit?.commit?.tree?.sha;
  if (!commitSha || !treeSha)
    throw new Error("GitHub did not return a commit for this branch.");
  const data = await (
    await checked(
      await fetch(
        `${endpoint}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
        { signal },
      ),
    )
  ).json();
  const entries: Entry[] = data.tree
    .filter(
      (e: { path: string; type: string }) =>
        includePath(e.path) && ["tree", "blob"].includes(e.type),
    )
    .map((e: { path: string; type: string; size?: number; sha: string }) => ({
      path: e.path,
      type: e.type === "tree" ? "folder" : "file",
      size: e.size,
      sha: e.sha,
    }));
  if (!entries.length)
    throw new Error("This repository has no browsable files.");
  if (entries.length > 12000)
    throw new Error(
      "This repository is too large for this explorer. Upload a smaller project ZIP.",
    );
  return {
    id: `${owner}/${name}@${commitSha}`,
    name,
    owner,
    branch: selectedBranch,
    description: meta.description || "",
    source: "github",
    entries,
    sha: commitSha,
    url: meta.html_url,
    warning: data.truncated
      ? "GitHub returned a partial tree. Some files are not shown."
      : undefined,
  };
}
export async function readFile(
  repo: Repository,
  entry: Entry,
  signal?: AbortSignal,
): Promise<string> {
  if (entry.content !== undefined) return entry.content;
  if (!textFile(entry.path))
    throw new Error(
      "This is a binary or generated file. Download the repository to inspect it.",
    );
  if ((entry.size || 0) > MAX_FILE)
    throw new Error("This file exceeds the 400 KB source preview limit.");
  if (USE_API) {
    const params = new URLSearchParams({
      owner: repo.owner,
      name: repo.name,
      path: entry.path,
      ref: repo.sha || repo.branch,
    });
    return (
      await (
        await checked(await fetch(`${API}/api/file?${params}`, { signal }))
      ).json()
    ).content;
  }
  const ref = repo.sha || repo.branch;
  const response = await checked(
    await fetch(
      `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${encodeURIComponent(ref)}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
      { signal },
    ),
  );
  const content = await response.text();
  if (new TextEncoder().encode(content).length > MAX_FILE)
    throw new Error("This file exceeds the 400 KB source preview limit.");
  if (content.includes("\0"))
    throw new Error("This file contains binary data and cannot be previewed.");
  return content;
}
export async function importZip(file: File): Promise<Repository> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose a ZIP smaller than 20 MB.");
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(file);
  const all = Object.values(zip.files).filter((e) => !e.dir);
  if (all.length > 12000)
    throw new Error(
      "The ZIP contains too many files. Upload a smaller project.",
    );
  const paths = all.map((e) => e.name);
  const first = paths[0]?.split("/")[0];
  const strip = first && paths.every((p) => p.startsWith(`${first}/`));
  const entries: Entry[] = [];
  let total = 0;
  let skipped = 0;
  for (const e of all) {
    const original =
      (e as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ||
      e.name;
    if (original.split("/").includes("..") || original.startsWith("/")) {
      skipped++;
      continue;
    }
    const path = strip ? e.name.slice(first.length + 1) : e.name;
    if (!includePath(path) || !textFile(path)) {
      skipped++;
      continue;
    }
    const size = (e as unknown as { _data?: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (size !== undefined && size > MAX_FILE) {
      skipped++;
      continue;
    }
    if (size !== undefined && total + size > 15 * 1024 * 1024)
      throw new Error("Expanded source files exceed the 15 MB limit.");
    const bytes = await e.async("uint8array");
    if (bytes.length > MAX_FILE || bytes.includes(0)) {
      skipped++;
      continue;
    }
    total += bytes.length;
    if (total > 15 * 1024 * 1024)
      throw new Error("Expanded source files exceed the 15 MB limit.");
    entries.push({
      path,
      type: "file",
      size: bytes.length,
      content: new TextDecoder().decode(bytes),
    });
  }
  if (!entries.length)
    throw new Error("No supported source files were found in this ZIP.");
  return {
    id: `zip-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`,
    name: file.name.replace(/\.zip$/i, ""),
    owner: "local",
    branch: "uploaded",
    description: "A local repository archive. Files stay in this browser tab.",
    source: "zip",
    entries,
    warning: skipped
      ? `${skipped} generated, binary, sensitive, or oversized files were excluded.`
      : undefined,
  };
}
