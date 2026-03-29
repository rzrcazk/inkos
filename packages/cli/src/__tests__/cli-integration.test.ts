import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StateManager } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(testDir, "..", "..");
const cliEntry = resolve(cliDir, "dist", "index.js");

let projectDir: string;

function run(args: string[], options?: { env?: Record<string, string>; cwd?: string }): string {
  return execFileSync("node", [cliEntry, ...args], {
    cwd: options?.cwd ?? projectDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      // Prevent global config from leaking into tests
      HOME: options?.cwd ?? projectDir,
      ...options?.env,
    },
    timeout: 10_000,
  });
}

function runStderr(
  args: string[],
  options?: { env?: Record<string, string>; cwd?: string },
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [cliEntry, ...args], {
      cwd: options?.cwd ?? projectDir,
      encoding: "utf-8",
      env: { ...process.env, HOME: options?.cwd ?? projectDir, ...options?.env },
      timeout: 10_000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout: string; stderr: string; status: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }
}

const failingLlmEnv = {
  INKOS_LLM_PROVIDER: "openai",
  INKOS_LLM_BASE_URL: "http://127.0.0.1:9/v1",
  INKOS_LLM_MODEL: "test-model",
  INKOS_LLM_API_KEY: "test-key",
};

describe("CLI integration", () => {
  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-test-"));
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function createIsolatedProjectDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    run(["init"], { cwd: dir });
    return dir;
  }

  describe("inkos --version", () => {
    it("prints version number", () => {
      const output = run(["--version"]);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("inkos --help", () => {
    it("prints help with command list", () => {
      const output = run(["--help"]);
      expect(output).toContain("inkos");
      expect(output).toContain("init");
      expect(output).toContain("book");
      expect(output).toContain("write");
    });
  });

  describe("inkos init", () => {
    it("initializes project in current directory", () => {
      const output = run(["init"]);
      expect(output).toContain("Project initialized");
    });

    it("creates inkos.json with correct structure", async () => {
      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.llm).toBeDefined();
      expect(config.llm.provider).toBeDefined();
      expect(config.llm.model).toBeDefined();
      expect(config.daemon).toBeDefined();
      expect(config.notify).toEqual([]);
    });

    it("creates .env file", async () => {
      const envContent = await readFile(join(projectDir, ".env"), "utf-8");
      expect(envContent).toContain("INKOS_LLM_API_KEY");
    });

    it("creates .gitignore", async () => {
      const gitignore = await readFile(join(projectDir, ".gitignore"), "utf-8");
      expect(gitignore).toContain(".env");
    });

    it("creates Node version hints for sqlite-backed memory features", async () => {
      await expect(readFile(join(projectDir, ".nvmrc"), "utf-8")).resolves.toContain("22");
      await expect(readFile(join(projectDir, ".node-version"), "utf-8")).resolves.toContain("22");
    });

    it("creates books/ and radar/ directories", async () => {
      const booksStat = await stat(join(projectDir, "books"));
      expect(booksStat.isDirectory()).toBe(true);
      const radarStat = await stat(join(projectDir, "radar"));
      expect(radarStat.isDirectory()).toBe(true);
    });
  });

  describe("inkos init <name>", () => {
    it("creates project in subdirectory", () => {
      const output = run(["init", "subproject"]);
      expect(output).toContain("Project initialized");
    });

    it("creates inkos.json in subdirectory", async () => {
      const raw = await readFile(join(projectDir, "subproject", "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.name).toBe("subproject");
    });

    it("supports absolute project paths instead of nesting them under cwd", async () => {
      const absoluteDir = await mkdtemp(join(tmpdir(), "inkos-cli-abs-init-"));

      try {
        const output = run(["init", absoluteDir]);
        expect(output).toContain(`Project initialized at ${absoluteDir}`);

        const raw = await readFile(join(absoluteDir, "inkos.json"), "utf-8");
        const config = JSON.parse(raw);
        expect(config.name).toBe(basename(absoluteDir));
      } finally {
        await rm(absoluteDir, { recursive: true, force: true });
      }
    });

    it("prints English next steps when initialized with --lang en", async () => {
      const englishDir = await mkdtemp(join(tmpdir(), "inkos-cli-en-init-"));

      try {
        const output = run(["init", englishDir, "--lang", "en"]);
        expect(output).toContain("Project initialized");
        expect(output).toContain("inkos book create --title 'My Novel'");
        expect(output).not.toContain("我的小说");
      } finally {
        await rm(englishDir, { recursive: true, force: true });
      }
    });
  });

  describe("inkos config set", () => {
    it("sets a known config value", () => {
      const output = run(["config", "set", "llm.provider", "anthropic"]);
      expect(output).toContain("Set llm.provider = anthropic");
    });

    it("sets a nested config value", async () => {
      run(["config", "set", "llm.model", "gpt-5"]);
      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.llm.model).toBe("gpt-5");
    });

    it("rejects unknown config keys", () => {
      expect(() => {
        run(["config", "set", "custom.nested.key", "value"]);
      }).toThrow();
    });

    it("sets input governance mode", async () => {
      const output = run(["config", "set", "inputGovernanceMode", "v2"]);
      expect(output).toContain("Set inputGovernanceMode = v2");

      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.inputGovernanceMode).toBe("v2");
    });
  });

  describe("inkos config show", () => {
    it("shows current config as JSON", () => {
      const output = run(["config", "show"]);
      const config = JSON.parse(output);
      expect(config.llm.model).toBe("gpt-5");
    });
  });

  describe("inkos config set-model", () => {
    it("rejects raw API keys passed to --api-key-env", async () => {
      const { exitCode, stderr } = runStderr([
        "config",
        "set-model",
        "writer",
        "gpt-4-turbo",
        "--provider",
        "custom",
        "--base-url",
        "https://poloai.top/v1",
        "--api-key-env",
        "sk-test-direct-key",
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--api-key-env expects an environment variable name");

      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.modelOverrides).toBeUndefined();
    });
  });

  describe("inkos book list", () => {
    it("shows no books in empty project", () => {
      const output = run(["book", "list"]);
      expect(output).toContain("No books found");
    });

    it("returns empty array in JSON mode", () => {
      const output = run(["book", "list", "--json"]);
      const data = JSON.parse(output);
      expect(data.books).toEqual([]);
    });
  });

  describe("inkos book create", () => {
    it("exposes narrative mode flag in help output", () => {
      const output = run(["book", "create", "--help"]);
      expect(output).toContain("--narrative-mode");
      expect(output).toContain("interactive-tree");
    });

    it("removes stale incomplete book directories before retrying create", async () => {
      try {
        await stat(join(projectDir, "inkos.json"));
      } catch {
        run(["init"]);
      }
      const bookId = "stale-book";
      const staleDir = join(projectDir, "books", bookId);
      await mkdir(join(staleDir, "story"), { recursive: true });
      await writeFile(join(staleDir, "book.json"), JSON.stringify({
        id: bookId,
        title: "Stale Book",
      }, null, 2));
      await writeFile(join(staleDir, "story", "current_state.md"), "# stale\n", "utf-8");

      const { exitCode, stderr } = runStderr([
        "book",
        "create",
        "--title",
        "stale book",
      ], {
        env: failingLlmEnv,
      });

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Failed to create book");
      await expect(stat(staleDir)).rejects.toThrow();
    });
  });

  describe("inkos branch", () => {
    it("lists branch tree and pending choices for an interactive book", async () => {
      const state = new StateManager(projectDir);
      const bookId = "interactive-cli";
      const bookDir = state.bookDir(bookId);
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Interactive CLI Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          narrativeMode: "interactive-tree",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await state.saveBranchTree(bookId, {
        version: 1,
        rootNodeId: "root",
        activeNodeId: "root",
        nodes: [
          {
            nodeId: "root",
            parentNodeId: null,
            sourceChapterId: null,
            sourceChapterNumber: 0,
            branchDepth: 0,
            branchLabel: "Main Route",
            status: "awaiting-choice",
            snapshotRef: { chapterNumber: 1 },
            selectedChoiceId: null,
            chapterIds: ["ch-0001"],
            displayPath: "main",
          },
          {
            nodeId: "node-a",
            parentNodeId: "root",
            sourceChapterId: "ch-0001",
            sourceChapterNumber: 1,
            branchDepth: 1,
            branchLabel: "接受交易",
            status: "dormant",
            snapshotRef: { chapterNumber: 1 },
            selectedChoiceId: null,
            chapterIds: [],
            displayPath: "main.a",
          },
        ],
        choices: [
          {
            choiceId: "choice-root-a",
            fromNodeId: "root",
            toNodeId: "node-a",
            label: "接受交易",
            intent: "接受看守的交易。",
            immediateGoal: "今晚进入档案室。",
            expectedCost: "欠下一笔人情。",
            expectedRisk: "会被持续监视。",
            hookPressure: "看守线推进。",
            characterPressure: "同伴信任下降。",
            tone: "紧张",
            selected: false,
          },
        ],
      });

      const treeOutput = run(["branch", "tree", bookId]);
      expect(treeOutput).toContain("Main Route");
      expect(treeOutput).toContain("node-a");

      const choicesOutput = run(["branch", "choices", bookId, "--json"]);
      const choices = JSON.parse(choicesOutput);
      expect(choices.activeNodeId).toBe("root");
      expect(choices.choices).toHaveLength(1);
      expect(choices.choices[0].choiceId).toBe("choice-root-a");
    });

    it("chooses and switches interactive branches", async () => {
      const state = new StateManager(projectDir);
      const bookId = "interactive-switch";
      const bookDir = state.bookDir(bookId);
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await mkdir(join(storyDir, "snapshots", "1"), { recursive: true });
      await mkdir(join(storyDir, "snapshots", "2"), { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Interactive Switch Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          narrativeMode: "interactive-tree",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await Promise.all([
        writeFile(join(storyDir, "snapshots", "1", "current_state.md"), "# Current State\n\n- Root snapshot.\n", "utf-8"),
        writeFile(join(storyDir, "snapshots", "1", "pending_hooks.md"), "# Pending Hooks\n\n- Root hook.\n", "utf-8"),
        writeFile(join(storyDir, "snapshots", "2", "current_state.md"), "# Current State\n\n- Route A snapshot.\n", "utf-8"),
        writeFile(join(storyDir, "snapshots", "2", "pending_hooks.md"), "# Pending Hooks\n\n- Route A hook.\n", "utf-8"),
      ]);
      await state.saveBranchTree(bookId, {
        version: 1,
        rootNodeId: "root",
        activeNodeId: "root",
        nodes: [
          {
            nodeId: "root",
            parentNodeId: null,
            sourceChapterId: null,
            sourceChapterNumber: 0,
            branchDepth: 0,
            branchLabel: "Main Route",
            status: "awaiting-choice",
            snapshotRef: { chapterNumber: 1 },
            selectedChoiceId: null,
            chapterIds: ["ch-0001"],
            displayPath: "main",
          },
          {
            nodeId: "node-a",
            parentNodeId: "root",
            sourceChapterId: "ch-0001",
            sourceChapterNumber: 1,
            branchDepth: 1,
            branchLabel: "A Route",
            status: "dormant",
            snapshotRef: { chapterNumber: 2 },
            selectedChoiceId: null,
            chapterIds: ["ch-0002"],
            displayPath: "main.a",
          },
          {
            nodeId: "node-b",
            parentNodeId: "root",
            sourceChapterId: "ch-0001",
            sourceChapterNumber: 1,
            branchDepth: 1,
            branchLabel: "B Route",
            status: "dormant",
            snapshotRef: { chapterNumber: 1 },
            selectedChoiceId: null,
            chapterIds: [],
            displayPath: "main.b",
          },
        ],
        choices: [
          {
            choiceId: "choice-root-a",
            fromNodeId: "root",
            toNodeId: "node-a",
            label: "A Route",
            intent: "Take route A.",
            immediateGoal: "Advance route A.",
            expectedCost: "Leave B behind.",
            expectedRisk: "Route A escalates.",
            hookPressure: "A hook advances.",
            characterPressure: "A pressure rises.",
            tone: "tense",
            selected: false,
          },
          {
            choiceId: "choice-root-b",
            fromNodeId: "root",
            toNodeId: "node-b",
            label: "B Route",
            intent: "Take route B.",
            immediateGoal: "Advance route B.",
            expectedCost: "Lose A momentum.",
            expectedRisk: "Route B resets pressure.",
            hookPressure: "B hook revives.",
            characterPressure: "B pressure returns.",
            tone: "quiet",
            selected: false,
          },
        ],
      });

      const chooseRun = runStderr(["branch", "choose", bookId, "choice-root-a", "--json"]);
      expect(chooseRun.exitCode).toBe(0);
      const chooseResult = JSON.parse(chooseRun.stdout);
      expect(chooseResult.activeNodeId).toBe("node-a");

      const switchRun = runStderr(["branch", "switch", bookId, "node-b", "--json"]);
      expect(switchRun.exitCode).toBe(0);
      const switchResult = JSON.parse(switchRun.stdout);
      expect(switchResult.activeNodeId).toBe("node-b");
      await expect(readFile(join(storyDir, "current_state.md"), "utf-8"))
        .resolves.toContain("Root snapshot.");
    });

    it("rejects branch commands cleanly for linear books", async () => {
      const bookDir = join(projectDir, "books", "linear-branch-book");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "linear-branch-book",
          title: "Linear Branch Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          narrativeMode: "linear",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");

      const result = runStderr(["branch", "tree", "linear-branch-book"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not an interactive-tree book");
    });
  });

  describe("inkos status", () => {
    it("shows project status with zero books", async () => {
      const isolatedDir = await createIsolatedProjectDir("inkos-cli-status-empty-");
      try {
        const output = run(["status"], { cwd: isolatedDir });
        expect(output).toContain("Books: 0");
      } finally {
        await rm(isolatedDir, { recursive: true, force: true });
      }
    });

    it("returns JSON with --json flag", async () => {
      const isolatedDir = await createIsolatedProjectDir("inkos-cli-status-json-");
      try {
        const output = run(["status", "--json"], { cwd: isolatedDir });
        const data = JSON.parse(output);
        expect(data.project).toBeDefined();
        expect(data.books).toEqual([]);
      } finally {
        await rm(isolatedDir, { recursive: true, force: true });
      }
    });

    it("errors for nonexistent book", () => {
      const { exitCode, stderr } = runStderr(["status", "nonexistent"]);
      expect(exitCode).not.toBe(0);
    });

    it("shows English chapter counts in words for chapter rows", async () => {
      const bookDir = join(projectDir, "books", "english-status");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "english-status",
          title: "English Status Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "A Quiet Sky",
            status: "ready-for-review",
            wordCount: 7,
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:00:00.000Z",
            auditIssues: [],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );

      const output = run(["status", "english-status", "--chapters"]);
      expect(output).toContain('Ch.1 "A Quiet Sky" | 7 words | ready-for-review');
      expect(output).not.toContain("7字");
    });

    it("shows a migration hint for legacy pre-v0.6 books", async () => {
      const bookDir = join(projectDir, "books", "legacy-status-hint");
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "legacy-status-hint",
          title: "Legacy Status Hint",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await writeFile(join(storyDir, "current_state.md"), "# Current State\n\nLegacy state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n", "utf-8");

      const output = run(["status", "legacy-status-hint"]);
      expect(output).toContain("legacy format");
    });

    it("reports persisted chapter file count instead of runtime progress when state runs ahead", async () => {
      const bookId = "ahead-status";
      const bookDir = join(projectDir, "books", bookId);
      const chaptersDir = join(bookDir, "chapters");
      const stateDir = join(bookDir, "story", "state");

      await mkdir(chaptersDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Ahead Status Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(chaptersDir, "0001_First.md"), "# 第1章 First\n\nOnly persisted chapter.", "utf-8");
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "First",
            status: "ready-for-review",
            wordCount: 42,
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
            auditIssues: [],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );
      await Promise.all([
        writeFile(
          join(stateDir, "manifest.json"),
          JSON.stringify({
            schemaVersion: 2,
            language: "zh",
            lastAppliedChapter: 4,
            projectionVersion: 1,
            migrationWarnings: [],
          }, null, 2),
          "utf-8",
        ),
        writeFile(
          join(stateDir, "current_state.json"),
          JSON.stringify({
            chapter: 4,
            facts: [],
          }, null, 2),
          "utf-8",
        ),
        writeFile(join(stateDir, "hooks.json"), JSON.stringify({ hooks: [] }, null, 2), "utf-8"),
        writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({ rows: [] }, null, 2), "utf-8"),
      ]);

      const output = run(["status", bookId]);
      expect(output).toContain("Chapters: 1 / 10");
      expect(output).not.toContain("Chapters: 4 / 10");

      const json = JSON.parse(run(["status", bookId, "--json"]));
      expect(json.books[0]?.chapters).toBe(1);
    });

    it("defaults interactive status, review, export, and eval to the active branch", async () => {
      const state = new StateManager(projectDir);
      const bookId = "interactive-visible-cli";
      const bookDir = state.bookDir(bookId);
      const chaptersDir = join(bookDir, "chapters");
      await mkdir(chaptersDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Interactive Visible CLI",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          narrativeMode: "interactive-tree",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "Seed",
            status: "ready-for-review",
            wordCount: 100,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z",
            auditIssues: [],
            lengthWarnings: [],
          },
          {
            number: 2,
            title: "Route A",
            status: "ready-for-review",
            wordCount: 120,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z",
            auditIssues: [],
            lengthWarnings: [],
          },
          {
            number: 3,
            title: "Route B",
            status: "ready-for-review",
            wordCount: 140,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z",
            auditIssues: [],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );
      await Promise.all([
        writeFile(join(chaptersDir, "0001_Seed.md"), "# Seed\n\nMain route chapter.\n", "utf-8"),
        writeFile(join(chaptersDir, "0002_Route_A.md"), "# Route A\n\nActive branch chapter.\n", "utf-8"),
        writeFile(join(chaptersDir, "0003_Route_B.md"), "# Route B\n\nDormant branch chapter.\n", "utf-8"),
      ]);
      await state.saveBranchTree(bookId, {
        version: 1,
        rootNodeId: "root",
        activeNodeId: "node-a",
        nodes: [
          {
            nodeId: "root",
            parentNodeId: null,
            sourceChapterId: null,
            sourceChapterNumber: 0,
            branchDepth: 0,
            branchLabel: "Main Route",
            status: "completed",
            snapshotRef: { chapterNumber: 1 },
            selectedChoiceId: "choice-root-a",
            chapterIds: ["ch-0001"],
            displayPath: "main",
          },
          {
            nodeId: "node-a",
            parentNodeId: "root",
            sourceChapterId: "ch-0001",
            sourceChapterNumber: 1,
            branchDepth: 1,
            branchLabel: "Route A",
            status: "active",
            snapshotRef: { chapterNumber: 2 },
            selectedChoiceId: null,
            chapterIds: ["ch-0002"],
            displayPath: "main.a",
          },
          {
            nodeId: "node-b",
            parentNodeId: "root",
            sourceChapterId: "ch-0001",
            sourceChapterNumber: 1,
            branchDepth: 1,
            branchLabel: "Route B",
            status: "dormant",
            snapshotRef: { chapterNumber: 1 },
            selectedChoiceId: null,
            chapterIds: ["ch-0003"],
            displayPath: "main.b",
          },
        ],
        choices: [
          {
            choiceId: "choice-root-a",
            fromNodeId: "root",
            toNodeId: "node-a",
            label: "Route A",
            intent: "Take route A.",
            immediateGoal: "Advance route A.",
            expectedCost: "Lose route B.",
            expectedRisk: "Conflict rises.",
            hookPressure: "A hook advances.",
            characterPressure: "A pressure rises.",
            tone: "tense",
            selected: true,
          },
          {
            choiceId: "choice-root-b",
            fromNodeId: "root",
            toNodeId: "node-b",
            label: "Route B",
            intent: "Take route B.",
            immediateGoal: "Advance route B.",
            expectedCost: "Lose route A.",
            expectedRisk: "Momentum drops.",
            hookPressure: "B hook advances.",
            characterPressure: "B pressure rises.",
            tone: "quiet",
            selected: false,
          },
        ],
      });

      const statusText = run(["status", bookId, "--chapters"]);
      expect(statusText).toContain("Chapters: 2 / 10");
      expect(statusText).toContain("Active branch: main.a (node-a) | active");
      expect(statusText).toContain('Ch.1 "Seed"');
      expect(statusText).toContain('Ch.2 "Route A"');
      expect(statusText).not.toContain('Ch.3 "Route B"');

      const statusJson = JSON.parse(run(["status", bookId, "--json"]));
      expect(statusJson.books[0]?.chapters).toBe(2);
      expect(statusJson.books[0]?.activeBranch).toEqual({
        activeNodeId: "node-a",
        displayPath: "main.a",
        status: "active",
        visibleChapterNumbers: [1, 2],
        pendingChoiceCount: 0,
      });

      const reviewJson = JSON.parse(run(["review", "list", bookId, "--json"]));
      expect(reviewJson.pending.map((row: { chapter: number }) => row.chapter)).toEqual([1, 2]);

      const exportDefault = join(projectDir, "interactive-default.txt");
      run(["export", bookId, "--format", "txt", "--output", exportDefault]);
      await expect(readFile(exportDefault, "utf-8")).resolves.toContain("Active branch chapter.");
      await expect(readFile(exportDefault, "utf-8")).resolves.not.toContain("Dormant branch chapter.");

      const evalJson = JSON.parse(run(["eval", bookId, "--json"]));
      expect(evalJson.totalChapters).toBe(2);
    });

    it("supports --all-branches for interactive status, review, export, and eval", async () => {
      const bookId = "interactive-visible-cli";

      const statusText = run(["status", bookId, "--chapters", "--all-branches"]);
      expect(statusText).toContain("Chapters: 3 / 10");
      expect(statusText).toContain('Ch.3 "Route B"');

      const reviewJson = JSON.parse(run(["review", "list", bookId, "--json", "--all-branches"]));
      expect(reviewJson.pending.map((row: { chapter: number }) => row.chapter)).toEqual([1, 2, 3]);

      const exportAll = join(projectDir, "interactive-all.txt");
      run(["export", bookId, "--format", "txt", "--output", exportAll, "--all-branches"]);
      await expect(readFile(exportAll, "utf-8")).resolves.toContain("Dormant branch chapter.");

      const evalJson = JSON.parse(run(["eval", bookId, "--json", "--all-branches"]));
      expect(evalJson.totalChapters).toBe(3);
    });
  });

  describe("inkos doctor", () => {
    it("checks environment health", () => {
      const { stdout } = runStderr(["doctor"]);
      expect(stdout).toContain("InkOS Doctor");
      expect(stdout).toContain("Node.js >= 20");
      expect(stdout).toContain("SQLite memory index");
      expect(stdout).toContain("inkos.json");
    });

    it("repairs missing node runtime pin files for old projects", async () => {
      await stat(join(projectDir, "inkos.json")).catch(() => {
        run(["init"]);
      });

      await rm(join(projectDir, ".nvmrc"), { force: true });
      await rm(join(projectDir, ".node-version"), { force: true });

      const before = runStderr(["doctor"]);
      expect(before.stdout).toContain("Node runtime pin files");
      expect(before.stdout).toContain(".nvmrc");
      expect(before.stdout).toContain(".node-version");

      const repaired = runStderr(["doctor", "--repair-node-runtime"]);
      expect(repaired.stdout).toContain("Node runtime pin files repaired");
      expect(repaired.stdout).toContain(".nvmrc");
      expect(repaired.stdout).toContain(".node-version");

      await expect(readFile(join(projectDir, ".nvmrc"), "utf-8")).resolves.toBe("22\n");
      await expect(readFile(join(projectDir, ".node-version"), "utf-8")).resolves.toBe("22\n");
    });

    it("treats localhost OpenAI-compatible endpoints as API-key optional", async () => {
      await stat(join(projectDir, "inkos.json")).catch(() => {
        run(["init"]);
      });
      const configPath = join(projectDir, "inkos.json");
      const envPath = join(projectDir, ".env");
      const originalConfig = await readFile(configPath, "utf-8");
      const originalEnv = await readFile(envPath, "utf-8");

      try {
        const config = JSON.parse(originalConfig);
        config.llm.provider = "openai";
        config.llm.baseUrl = "http://127.0.0.1:11434/v1";
        config.llm.model = "gpt-oss:20b";
        await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
        await writeFile(envPath, [
          "INKOS_LLM_PROVIDER=openai",
          "INKOS_LLM_BASE_URL=http://127.0.0.1:11434/v1",
          "INKOS_LLM_MODEL=gpt-oss:20b",
          "",
        ].join("\n"), "utf-8");

        const { stdout } = runStderr(["doctor"], {
          env: { INKOS_LLM_API_KEY: "" },
        });
        expect(stdout).toContain("LLM API Key");
        expect(stdout).toContain("Optional for local/self-hosted endpoint");
        expect(stdout).toContain("LLM Config");
        expect(stdout).not.toContain("No LLM config available");
      } finally {
        await writeFile(configPath, originalConfig, "utf-8");
        await writeFile(envPath, originalEnv, "utf-8");
      }
    });

    it("reports legacy books in the version migration check", async () => {
      const bookDir = join(projectDir, "books", "legacy-doctor-hint");
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "legacy-doctor-hint",
          title: "Legacy Doctor Hint",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await writeFile(join(storyDir, "current_state.md"), "# Current State\n\nLegacy state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n", "utf-8");

      const { stdout } = runStderr(["doctor"]);
      expect(stdout).toContain("Version Migration");
      expect(stdout).toContain("legacy format");
    });
  });

  describe("inkos write", () => {
    it("warns before writing when the target book still uses legacy format", async () => {
      const bookDir = join(projectDir, "books", "legacy-write-hint");
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "legacy-write-hint",
          title: "Legacy Write Hint",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await writeFile(join(storyDir, "current_state.md"), "# Current State\n\nLegacy state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n", "utf-8");

      const { stdout, stderr } = runStderr(["write", "next", "legacy-write-hint"], {
        env: failingLlmEnv,
      });
      expect(`${stdout}\n${stderr}`).toContain("legacy format");
    });

    it("keeps next chapter at 2 after rewrite 2 trims later chapters, even if regeneration fails", async () => {
      const state = new StateManager(projectDir);
      const bookId = "rewrite-cli";
      const bookDir = join(projectDir, "books", bookId);
      const storyDir = join(bookDir, "story");
      const chaptersDir = join(bookDir, "chapters");
      const stateDir = join(storyDir, "state");

      await mkdir(chaptersDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Rewrite CLI",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(storyDir, "current_state.md"), "State at ch1", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch1", "utf-8");
      await writeFile(join(chaptersDir, "0001_ch1.md"), "# Chapter 1\n\nContent 1", "utf-8");
      await writeFile(join(chaptersDir, "0002_ch2.md"), "# Chapter 2\n\nContent 2", "utf-8");
      await writeFile(join(chaptersDir, "0003_ch3.md"), "# Chapter 3\n\nContent 3", "utf-8");
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          { number: 1, title: "Ch1", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
          { number: 2, title: "Ch2", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
          { number: 3, title: "Ch3", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
        ], null, 2),
        "utf-8",
      );

      await state.snapshotState(bookId, 1);

      await writeFile(join(storyDir, "current_state.md"), "State at ch3", "utf-8");
      await writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 4,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8");
      await writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 3,
        facts: [],
      }, null, 2), "utf-8");

      const { exitCode, stdout, stderr } = runStderr(["write", "rewrite", bookId, "2", "--force"], {
        env: failingLlmEnv,
      });
      expect(exitCode).not.toBe(0);
      expect(`${stdout}\n${stderr}`).toContain("Regenerating chapter 2");

      const next = await state.getNextChapterNumber(bookId);
      expect(next).toBe(2);
      await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe("State at ch1");
    });
  });

  describe("inkos analytics", () => {
    it("errors when no book exists", () => {
      const { exitCode } = runStderr(["analytics"]);
      expect(exitCode).not.toBe(0);
    });
  });

  describe("inkos plan/compose", () => {
    beforeAll(async () => {
      const configPath = join(projectDir, "inkos.json");
      const initialized = await stat(configPath).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);

      const bookDir = join(projectDir, "books", "cli-book");
      const storyDir = join(bookDir, "story");
      await mkdir(join(storyDir, "runtime"), { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "cli-book",
          title: "CLI Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 3000,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8").catch(async () => {
        await mkdir(join(bookDir, "chapters"), { recursive: true });
        await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      });

      await Promise.all([
        writeFile(join(storyDir, "author_intent.md"), "# Author Intent\n\nKeep the story centered on the mentor conflict.\n", "utf-8"),
        writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
        writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
        writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
        writeFile(join(storyDir, "book_rules.md"), "---\nprohibitions:\n  - Do not reveal the mastermind\n---\n\n# Book Rules\n", "utf-8"),
        writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
      ]);
    });

    it("runs plan chapter and returns the generated intent path in JSON mode", async () => {
      const output = run(["plan", "chapter", "cli-book", "--json", "--context", "Ignore the guild chase and focus on the mentor conflict."]);
      const data = JSON.parse(output);

      expect(data.bookId).toBe("cli-book");
      expect(data.chapterNumber).toBe(1);
      expect(data.intentPath).toContain("story/runtime/chapter-0001.intent.md");
      await expect(stat(join(projectDir, "books", "cli-book", data.intentPath))).resolves.toBeTruthy();
    });

    it("runs compose chapter and returns runtime artifact paths in JSON mode", async () => {
      const output = run(["compose", "chapter", "cli-book", "--json"]);
      const data = JSON.parse(output);

      expect(data.bookId).toBe("cli-book");
      expect(data.chapterNumber).toBe(1);
      expect(data.contextPath).toContain("story/runtime/chapter-0001.context.json");
      expect(data.ruleStackPath).toContain("story/runtime/chapter-0001.rule-stack.yaml");
      expect(data.tracePath).toContain("story/runtime/chapter-0001.trace.json");

      await expect(stat(join(projectDir, "books", "cli-book", data.contextPath))).resolves.toBeTruthy();
      await expect(stat(join(projectDir, "books", "cli-book", data.ruleStackPath))).resolves.toBeTruthy();
      await expect(stat(join(projectDir, "books", "cli-book", data.tracePath))).resolves.toBeTruthy();
    });

    it("reuses the planned intent when compose runs without a new context", async () => {
      const plannedGoal = "Ignore the guild chase and focus on the mentor conflict.";
      run(["plan", "chapter", "cli-book", "--context", plannedGoal]);

      const output = run(["compose", "chapter", "cli-book", "--json"]);
      const data = JSON.parse(output);
      const intentMarkdown = await readFile(join(projectDir, "books", "cli-book", data.intentPath), "utf-8");

      expect(data.goal).toBe(plannedGoal);
      expect(intentMarkdown).toContain(plannedGoal);
    });
  });

  describe("inkos export", () => {
    beforeAll(async () => {
      const configPath = join(projectDir, "inkos.json");
      const initialized = await stat(configPath).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);

      const bookDir = join(projectDir, "books", "export-book");
      await mkdir(join(bookDir, "chapters"), { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "export-book",
          title: "Export Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2000,
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "Dawn Ledger",
            status: "ready-for-review",
            wordCount: 1200,
            createdAt: "2026-03-23T00:00:00.000Z",
            updatedAt: "2026-03-23T00:00:00.000Z",
            auditIssues: [],
          },
        ], null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "0001_Dawn_Ledger.md"),
        "# 第1章 Dawn Ledger\n\n正文。\n",
        "utf-8",
      );
    });

    it("creates missing parent directories for custom output paths", async () => {
      const outputPath = join(projectDir, "exports", "nested", "book.md");
      const output = run(["export", "export-book", "--format", "md", "--output", outputPath, "--json"]);
      const data = JSON.parse(output);

      expect(data.outputPath).toBe(outputPath);
      await expect(stat(outputPath)).resolves.toBeTruthy();
      await expect(readFile(outputPath, "utf-8")).resolves.toContain("# Export Book");
    });
  });
});
