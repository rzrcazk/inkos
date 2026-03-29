import { readFile, writeFile, mkdir, readdir, rm, stat, unlink, open } from "node:fs/promises";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import {
  InteractiveBranchTreeSchema,
  type InteractiveBranchTree,
} from "../models/interactive-fiction.js";
import { bootstrapStructuredStateFromMarkdown, resolveDurableStoryProgress } from "./state-bootstrap.js";

export class StateManager {
  constructor(private readonly projectRoot: string) {}

  private static defaultAuthorIntent(language: "zh" | "en"): string {
    return language === "zh"
      ? "# 作者意图\n\n（在这里描述这本书的长期创作方向。）\n"
      : "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n";
  }

  private static defaultCurrentFocus(language: "zh" | "en"): string {
    return language === "zh"
      ? "# 当前聚焦\n\n## 当前重点\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n"
      : "# Current Focus\n\n## Active Focus\n\n(Describe what the next 1-3 chapters should prioritize.)\n";
  }

  async ensureControlDocuments(bookId: string, authorIntent?: string): Promise<void> {
    const language = await this.resolveControlDocumentLanguage(bookId);
    await this.ensureControlDocumentsAt(this.bookDir(bookId), language, authorIntent);
  }

  async ensureControlDocumentsAt(
    bookDir: string,
    language: "zh" | "en",
    authorIntent?: string,
  ): Promise<void> {
    const storyDir = join(bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");

    await mkdir(storyDir, { recursive: true });
    await mkdir(runtimeDir, { recursive: true });

    await this.writeIfMissing(
      join(storyDir, "author_intent.md"),
      authorIntent?.trim()
        ? authorIntent.trimEnd() + "\n"
        : StateManager.defaultAuthorIntent(language),
    );

    await this.writeIfMissing(
      join(storyDir, "current_focus.md"),
      StateManager.defaultCurrentFocus(language),
    );
  }

  async loadControlDocuments(bookId: string): Promise<{
    authorIntent: string;
    currentFocus: string;
    runtimeDir: string;
  }> {
    await this.ensureControlDocuments(bookId);

    const storyDir = join(this.bookDir(bookId), "story");
    const runtimeDir = join(storyDir, "runtime");
    const [authorIntent, currentFocus] = await Promise.all([
      readFile(join(storyDir, "author_intent.md"), "utf-8"),
      readFile(join(storyDir, "current_focus.md"), "utf-8"),
    ]);

    return { authorIntent, currentFocus, runtimeDir };
  }

  private async resolveControlDocumentLanguage(bookId: string): Promise<"zh" | "en"> {
    try {
      const raw = await readFile(join(this.bookDir(bookId), "book.json"), "utf-8");
      const parsed = JSON.parse(raw) as { language?: unknown };
      return parsed.language === "zh" ? "zh" : "en";
    } catch {
      return "en";
    }
  }

  async acquireBookLock(bookId: string): Promise<() => Promise<void>> {
    await mkdir(this.bookDir(bookId), { recursive: true });
    const lockPath = join(this.bookDir(bookId), ".write.lock");
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(`pid:${process.pid} ts:${Date.now()}`, "utf-8");
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
      await handle.close();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code === "EEXIST") {
        const lockData = await readFile(lockPath, "utf-8").catch(() => "pid:unknown ts:unknown");
        const lockPid = this.extractLockPid(lockData);
        if (lockPid !== undefined && !this.isProcessAlive(lockPid)) {
          await unlink(lockPath).catch(() => undefined);
          return this.acquireBookLock(bookId);
        }
        throw new Error(
          `Book "${bookId}" is locked by another process (${lockData}). ` +
            `If this is stale, delete ${lockPath}`,
        );
      }
      throw e;
    }
    return async () => {
      try {
        await unlink(lockPath);
      } catch {
        // ignore
      }
    };
  }

  private extractLockPid(lockData: string): number | undefined {
    const match = lockData.match(/pid:(\d+)/);
    if (!match) return undefined;
    const pid = Number.parseInt(match[1] ?? "", 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ESRCH") {
        return false;
      }
      return true;
    }
  }

  get booksDir(): string {
    return join(this.projectRoot, "books");
  }

  bookDir(bookId: string): string {
    return join(this.booksDir, bookId);
  }

  stateDir(bookId: string): string {
    return join(this.bookDir(bookId), "story", "state");
  }

  interactiveDir(bookId: string): string {
    return join(this.bookDir(bookId), "story", "interactive");
  }

  interactiveDirAt(bookDir: string): string {
    return join(bookDir, "story", "interactive");
  }

  async loadProjectConfig(): Promise<Record<string, unknown>> {
    const configPath = join(this.projectRoot, "inkos.json");
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw);
  }

  async saveProjectConfig(config: Record<string, unknown>): Promise<void> {
    const configPath = join(this.projectRoot, "inkos.json");
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  async loadBookConfig(bookId: string): Promise<BookConfig> {
    const configPath = join(this.bookDir(bookId), "book.json");
    const raw = await readFile(configPath, "utf-8");
    if (!raw.trim()) {
      throw new Error(`book.json is empty for book "${bookId}"`);
    }
    return JSON.parse(raw) as BookConfig;
  }

  async saveBookConfig(bookId: string, config: BookConfig): Promise<void> {
    await this.saveBookConfigAt(this.bookDir(bookId), config);
  }

  async saveBookConfigAt(bookDir: string, config: BookConfig): Promise<void> {
    await mkdir(bookDir, { recursive: true });
    await writeFile(
      join(bookDir, "book.json"),
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  async ensureRuntimeState(bookId: string, fallbackChapter = 0): Promise<void> {
    await bootstrapStructuredStateFromMarkdown({
      bookDir: this.bookDir(bookId),
      fallbackChapter,
    });
  }

  async listBooks(): Promise<ReadonlyArray<string>> {
    try {
      const entries = await readdir(this.booksDir);
      const bookIds: string[] = [];
      for (const entry of entries) {
        const bookJsonPath = join(this.booksDir, entry, "book.json");
        try {
          await stat(bookJsonPath);
          bookIds.push(entry);
        } catch {
          // not a book directory
        }
      }
      return bookIds;
    } catch {
      return [];
    }
  }

  async getNextChapterNumber(bookId: string): Promise<number> {
    const index = await this.loadChapterIndex(bookId);
    const indexedChapter = index.length > 0
      ? Math.max(...index.map((ch) => ch.number))
      : 0;
    const runtimeState = await bootstrapStructuredStateFromMarkdown({
      bookDir: this.bookDir(bookId),
      fallbackChapter: indexedChapter,
    });
    const durableChapter = await resolveDurableStoryProgress({
      bookDir: this.bookDir(bookId),
      fallbackChapter: indexedChapter,
    });
    return Math.max(indexedChapter, durableChapter, runtimeState.manifest.lastAppliedChapter) + 1;
  }

  async loadChapterIndex(bookId: string): Promise<ReadonlyArray<ChapterMeta>> {
    const indexPath = join(this.bookDir(bookId), "chapters", "index.json");
    try {
      const raw = await readFile(indexPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async saveChapterIndex(
    bookId: string,
    index: ReadonlyArray<ChapterMeta>,
  ): Promise<void> {
    await this.saveChapterIndexAt(this.bookDir(bookId), index);
  }

  async saveChapterIndexAt(
    bookDir: string,
    index: ReadonlyArray<ChapterMeta>,
  ): Promise<void> {
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify(index, null, 2),
      "utf-8",
    );
  }

  async loadBranchTree(bookId: string): Promise<InteractiveBranchTree | null> {
    return this.loadBranchTreeAt(this.bookDir(bookId));
  }

  async loadBranchTreeAt(bookDir: string): Promise<InteractiveBranchTree | null> {
    const treePath = join(this.interactiveDirAt(bookDir), "branch-tree.json");
    try {
      const raw = await readFile(treePath, "utf-8");
      return InteractiveBranchTreeSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async saveBranchTree(bookId: string, tree: InteractiveBranchTree): Promise<void> {
    await this.saveBranchTreeAt(this.bookDir(bookId), tree);
  }

  async saveBranchTreeAt(bookDir: string, tree: InteractiveBranchTree): Promise<void> {
    const interactiveDir = this.interactiveDirAt(bookDir);
    await mkdir(interactiveDir, { recursive: true });
    await writeFile(
      join(interactiveDir, "branch-tree.json"),
      JSON.stringify(InteractiveBranchTreeSchema.parse(tree), null, 2),
      "utf-8",
    );
  }

  async ensureInteractiveTree(bookId: string): Promise<InteractiveBranchTree> {
    return this.ensureInteractiveTreeAt(this.bookDir(bookId));
  }

  async getPendingInteractiveChoice(bookId: string): Promise<{
    activeNodeId: string;
    choiceIds: ReadonlyArray<string>;
  } | null> {
    const book = await this.loadBookConfig(bookId).catch(() => null);
    if (!book || book.narrativeMode !== "interactive-tree") {
      return null;
    }

    const tree = await this.loadBranchTree(bookId);
    if (!tree) {
      return null;
    }

    const activeNode = tree.nodes.find((node) => node.nodeId === tree.activeNodeId);
    if (!activeNode || activeNode.status !== "awaiting-choice") {
      return null;
    }

    return {
      activeNodeId: activeNode.nodeId,
      choiceIds: tree.choices
        .filter((choice) => choice.fromNodeId === activeNode.nodeId && !choice.selected)
        .map((choice) => choice.choiceId),
    };
  }

  async loadActiveBranchView(bookId: string): Promise<{
    activeNodeId: string;
    displayPath: string;
    status: "active" | "awaiting-choice" | "dormant" | "completed";
    visibleChapterNumbers: ReadonlyArray<number>;
    pendingChoiceCount: number;
  } | null> {
    const book = await this.loadBookConfig(bookId).catch(() => null);
    if (!book || book.narrativeMode !== "interactive-tree") {
      return null;
    }

    const tree = await this.loadBranchTree(bookId);
    if (!tree) {
      return null;
    }

    const nodeMap = new Map(tree.nodes.map((node) => [node.nodeId, node]));
    const activeNode = nodeMap.get(tree.activeNodeId);
    if (!activeNode) {
      return null;
    }

    const lineage = this.resolveInteractiveLineage(nodeMap, activeNode.nodeId);
    const visibleChapterNumbers = this.resolveInteractiveChapterNumbers(lineage);
    const pendingChoiceCount = tree.choices.filter(
      (choice) => choice.fromNodeId === activeNode.nodeId && !choice.selected,
    ).length;

    return {
      activeNodeId: activeNode.nodeId,
      displayPath: activeNode.displayPath,
      status: activeNode.status,
      visibleChapterNumbers,
      pendingChoiceCount,
    };
  }

  async loadVisibleChapterIndex(
    bookId: string,
    options?: { readonly allBranches?: boolean },
  ): Promise<ReadonlyArray<ChapterMeta>> {
    const index = await this.loadChapterIndex(bookId);
    if (options?.allBranches) {
      return index;
    }

    const view = await this.loadActiveBranchView(bookId);
    if (!view) {
      return index;
    }

    const visibleNumbers = new Set(view.visibleChapterNumbers);
    return index.filter((chapter) => visibleNumbers.has(chapter.number));
  }

  async getPersistedChapterCount(
    bookId: string,
    options?: { readonly allBranches?: boolean },
  ): Promise<number> {
    const persistedNumbers = await this.getPersistedChapterNumbers(bookId);
    if (options?.allBranches) {
      return persistedNumbers.length;
    }

    const view = await this.loadActiveBranchView(bookId);
    if (!view) {
      return persistedNumbers.length;
    }

    const visibleNumbers = new Set(view.visibleChapterNumbers);
    return persistedNumbers.filter((chapterNumber) => visibleNumbers.has(chapterNumber)).length;
  }

  async ensureInteractiveTreeAt(bookDir: string): Promise<InteractiveBranchTree> {
    const existing = await this.loadBranchTreeAt(bookDir);
    if (existing) {
      return existing;
    }

    const rootTree: InteractiveBranchTree = {
      version: 1,
      activeNodeId: "root",
      rootNodeId: "root",
      nodes: [
        {
          nodeId: "root",
          parentNodeId: null,
          sourceChapterId: null,
          sourceChapterNumber: 0,
          branchDepth: 0,
          branchLabel: "Main Route",
          status: "active",
          snapshotRef: {
            chapterNumber: 0,
          },
          selectedChoiceId: null,
          chapterIds: [],
          displayPath: "main",
        },
      ],
      choices: [],
    };

    await this.saveBranchTreeAt(bookDir, rootTree);
    return rootTree;
  }

  async snapshotState(bookId: string, chapterNumber: number): Promise<void> {
    await this.snapshotStateAt(this.bookDir(bookId), chapterNumber);
  }

  private resolveInteractiveLineage(
    nodeMap: ReadonlyMap<string, InteractiveBranchTree["nodes"][number]>,
    startNodeId: string,
  ): ReadonlyArray<InteractiveBranchTree["nodes"][number]> {
    const lineage: InteractiveBranchTree["nodes"] = [];
    const visited = new Set<string>();
    let cursor = nodeMap.get(startNodeId) ?? null;

    while (cursor && !visited.has(cursor.nodeId)) {
      lineage.push(cursor);
      visited.add(cursor.nodeId);
      cursor = cursor.parentNodeId ? nodeMap.get(cursor.parentNodeId) ?? null : null;
    }

    return lineage.reverse();
  }

  private resolveInteractiveChapterNumbers(
    lineage: ReadonlyArray<InteractiveBranchTree["nodes"][number]>,
  ): ReadonlyArray<number> {
    const numbers: number[] = [];
    const seen = new Set<number>();

    for (const node of lineage) {
      for (const chapterId of node.chapterIds) {
        const match = chapterId.match(/^ch-(\d+)$/);
        if (!match) continue;
        const chapterNumber = Number.parseInt(match[1] ?? "", 10);
        if (!Number.isInteger(chapterNumber) || seen.has(chapterNumber)) {
          continue;
        }
        seen.add(chapterNumber);
        numbers.push(chapterNumber);
      }
    }

    return numbers;
  }

  private async getPersistedChapterNumbers(bookId: string): Promise<ReadonlyArray<number>> {
    const chaptersDir = join(this.bookDir(bookId), "chapters");
    const chapterNumbers = new Set<number>();

    try {
      const files = await readdir(chaptersDir);
      for (const file of files) {
        const match = file.match(/^(\d+)_.*\.md$/);
        if (!match) continue;
        chapterNumbers.add(parseInt(match[1]!, 10));
      }
    } catch {
      return [];
    }

    return [...chapterNumbers].sort((a, b) => a - b);
  }

  async snapshotStateAt(bookDir: string, chapterNumber: number): Promise<void> {
    const storyDir = join(bookDir, "story");
    const snapshotDir = join(storyDir, "snapshots", String(chapterNumber));
    await mkdir(snapshotDir, { recursive: true });

    const files = [
      "current_state.md", "particle_ledger.md", "pending_hooks.md",
      "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    ];
    await Promise.all(
      files.map(async (f) => {
        try {
          const content = await readFile(join(storyDir, f), "utf-8");
          await writeFile(join(snapshotDir, f), content, "utf-8");
        } catch {
          // file doesn't exist yet
        }
      }),
    );

    const stateDir = join(bookDir, "story", "state");
    const snapshotStateDir = join(snapshotDir, "state");
    try {
      const stateFiles = await readdir(stateDir);
      if (stateFiles.length > 0) {
        await mkdir(snapshotStateDir, { recursive: true });
        await Promise.all(
          stateFiles.map(async (fileName) => {
            const content = await readFile(join(stateDir, fileName), "utf-8");
            await writeFile(join(snapshotStateDir, fileName), content, "utf-8");
          }),
        );
      }
    } catch {
      // state directory missing — skip
    }
  }

  async isCompleteBookDirectory(bookDir: string): Promise<boolean> {
    const requiredPaths = [
      join(bookDir, "book.json"),
      join(bookDir, "story", "story_bible.md"),
      join(bookDir, "story", "volume_outline.md"),
      join(bookDir, "story", "book_rules.md"),
      join(bookDir, "story", "current_state.md"),
      join(bookDir, "story", "pending_hooks.md"),
      join(bookDir, "chapters", "index.json"),
    ];

    for (const requiredPath of requiredPaths) {
      try {
        await stat(requiredPath);
      } catch {
        return false;
      }
    }

    return true;
  }

  async restoreState(bookId: string, chapterNumber: number): Promise<boolean> {
    const storyDir = join(this.bookDir(bookId), "story");
    const snapshotDir = join(storyDir, "snapshots", String(chapterNumber));

    const files = [
      "current_state.md", "particle_ledger.md", "pending_hooks.md",
      "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    ];
    try {
      // current_state.md and pending_hooks.md are required;
      // particle_ledger.md is optional (numericalSystem=false genres don't have it)
      // the rest are optional (may not exist in older snapshots)
      const requiredFiles = ["current_state.md", "pending_hooks.md"];
      const optionalFiles = files.filter((f) => !requiredFiles.includes(f));

      await Promise.all(
        requiredFiles.map(async (f) => {
          const content = await readFile(join(snapshotDir, f), "utf-8");
          await writeFile(join(storyDir, f), content, "utf-8");
        }),
      );

      await Promise.all(
        optionalFiles.map(async (f) => {
          try {
            const content = await readFile(join(snapshotDir, f), "utf-8");
            await writeFile(join(storyDir, f), content, "utf-8");
          } catch {
            // Optional file missing — skip
          }
        }),
      );

      const stateDir = this.stateDir(bookId);
      let restoredStructuredState = false;
      try {
        const snapshotStateDir = join(snapshotDir, "state");
        const stateFiles = await readdir(snapshotStateDir);
        if (stateFiles.length > 0) {
          restoredStructuredState = true;
          await mkdir(stateDir, { recursive: true });
          await Promise.all(
            stateFiles.map(async (fileName) => {
              const content = await readFile(join(snapshotStateDir, fileName), "utf-8");
              await writeFile(join(stateDir, fileName), content, "utf-8");
            }),
          );
        }
      } catch {
        // snapshot structured state missing — skip
      }
      if (!restoredStructuredState) {
        await rm(stateDir, { recursive: true, force: true });
      }

      return true;
    } catch {
      return false;
    }
  }

  private async writeIfMissing(path: string, content: string): Promise<void> {
    try {
      await stat(path);
    } catch {
      await writeFile(path, content, "utf-8");
    }
  }
}
