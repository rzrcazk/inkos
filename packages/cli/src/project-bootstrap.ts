import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { loadGlobalSecrets } from "@actalk/inkos-core";

export interface ProjectBootstrapOptions {
  readonly language?: "zh" | "en";
  readonly overwriteSupportFiles?: boolean;
}

async function hasGlobalConfig(): Promise<boolean> {
  try {
    const secrets = await loadGlobalSecrets();
    return Object.values(secrets.services).some((s) => s?.apiKey && !s.apiKey.includes("your-api-key"));
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeMaybe(path: string, content: string, overwrite: boolean): Promise<void> {
  if (!overwrite && await exists(path)) {
    return;
  }
  await writeFile(path, content, "utf-8");
}

const DEFAULT_GITIGNORE_ENTRIES = ["node_modules/", ".DS_Store"] as const;

export async function ensureProjectGitignore(projectDir: string): Promise<void> {
  const path = join(projectDir, ".gitignore");
  let existing = "";
  if (await exists(path)) {
    existing = await readFile(path, "utf-8");
  }

  const existingEntries = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  const missing = DEFAULT_GITIGNORE_ENTRIES.filter((entry) => !existingEntries.has(entry));
  if (missing.length === 0) return;

  if (!existing) {
    await writeFile(path, `${missing.join("\n")}\n`, "utf-8");
    return;
  }

  const separator = existing.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${existing}${separator}${missing.join("\n")}\n`, "utf-8");
}

function buildProjectConfig(projectDir: string, language: "zh" | "en") {
  return {
    name: basename(projectDir),
    version: "0.1.0" as const,
    language,
    llm: {
      provider: "openai" as const,
      service: "custom",
      configSource: "studio" as const,
      baseUrl: "",
      model: "",
      apiFormat: "chat" as const,
      stream: true,
    },
    notify: [],
    inputGovernanceMode: "v2" as const,
    daemon: {
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * *",
      },
      maxConcurrentBooks: 3,
    },
  };
}

export async function initializeProjectDirectory(
  projectDir: string,
  options: ProjectBootstrapOptions = {},
): Promise<void> {
  const language = options.language ?? "zh";
  const overwriteSupportFiles = options.overwriteSupportFiles ?? true;
  const configPath = join(projectDir, "inkos.json");

  if (await exists(configPath)) {
    throw new Error(`inkos.json already exists in ${projectDir}. Use a different directory or delete the existing project.`);
  }

  await mkdir(projectDir, { recursive: true });
  await mkdir(join(projectDir, "books"), { recursive: true });
  await mkdir(join(projectDir, "radar"), { recursive: true });

  await writeFile(
    configPath,
    JSON.stringify(buildProjectConfig(projectDir, language), null, 2),
    "utf-8",
  );

  await Promise.all([
    ensureProjectGitignore(projectDir),
    writeMaybe(join(projectDir, ".nvmrc"), "22\n", overwriteSupportFiles),
    writeMaybe(join(projectDir, ".node-version"), "22\n", overwriteSupportFiles),
  ]);
}

export async function ensureProjectDirectoryInitialized(
  projectDir: string,
  options: Omit<ProjectBootstrapOptions, "overwriteSupportFiles"> = {},
): Promise<boolean> {
  const configPath = join(projectDir, "inkos.json");
  if (await exists(configPath)) {
    return false;
  }

  await initializeProjectDirectory(projectDir, {
    language: options.language,
    overwriteSupportFiles: false,
  });
  return true;
}
