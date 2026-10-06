import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// The site serves the model, so it serves Quran Lab's license beside it
// (NPL-1.2 §7). Two copies of one text: they must never drift apart.
describe("the model's license", () => {
  const canonical = read("../../LICENSES/Quran-Lab-NPL-1.2.txt");
  const served = read("../public/licenses/quran-lab-npl-1.2.txt");
  const own = read("../LICENSE");
  const engine = read("../../Engine/LICENSE");
  const root = read("../../LICENSE");

  it("is served by the site exactly as it stands in the repository", () => {
    expect(served).toBe(canonical);
  });

  // The engine and the prompter are under the same license as the model they run.
  it("is the prompter's, the engine's and the repository's own license, word for word", () => {
    expect(own).toBe(canonical);
    expect(engine).toBe(canonical);
    expect(root).toBe(canonical);
  });

  it("is the full NPL-1.2 text", () => {
    expect(canonical).toMatch(/^Quran-Lab No-Profit License\nVersion 1\.2 \(NPL-1\.2\)/);
    expect(canonical).toContain("7. SHARE-ALIKE");
    expect(canonical).toContain("13. NOT A RULING ON ANYONE'S LIVELIHOOD");
  });
});
