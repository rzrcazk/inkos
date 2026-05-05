import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SecretsFile {
  services: Record<string, { apiKey: string }>;
}

const SECRETS_DIR = ".inkos";
const SECRETS_FILE = "secrets.json";
const GLOBAL_SECRETS_PATH = join(homedir(), ".inkos", SECRETS_FILE);

const LEGACY_SERVICE_ID_REMAP: Record<string, string> = {
  siliconflow: "siliconcloud",
};

function migrateLegacyServiceIds(secrets: SecretsFile): { data: SecretsFile; changed: boolean } {
  let changed = false;
  for (const [oldId, newId] of Object.entries(LEGACY_SERVICE_ID_REMAP)) {
    if (secrets.services[oldId] && !secrets.services[newId]) {
      secrets.services[newId] = secrets.services[oldId];
      delete secrets.services[oldId];
      changed = true;
    }
  }
  return { data: secrets, changed };
}

async function readSecretsRaw(projectRoot: string): Promise<SecretsFile> {
  try {
    const raw = await readFile(
      join(projectRoot, SECRETS_DIR, SECRETS_FILE),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as SecretsFile;
    if (!parsed || typeof parsed !== "object" || !parsed.services) {
      return { services: {} };
    }
    return parsed;
  } catch {
    return { services: {} };
  }
}

export async function loadSecrets(projectRoot: string): Promise<SecretsFile> {
  const raw = await readSecretsRaw(projectRoot);
  const { data, changed } = migrateLegacyServiceIds(raw);
  if (changed) await saveSecrets(projectRoot, data);
  return data;
}

export async function saveSecrets(
  projectRoot: string,
  secrets: SecretsFile,
): Promise<void> {
  const dir = join(projectRoot, SECRETS_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, SECRETS_FILE),
    JSON.stringify(secrets, null, 2),
    "utf-8",
  );
}

export async function getServiceApiKey(
  projectRoot: string,
  service: string,
): Promise<string | null> {
  // 1. Project secrets: .inkos/secrets.json
  const secrets = await loadSecrets(projectRoot);
  const entry = secrets.services[service];
  if (entry?.apiKey) return entry.apiKey;

  // 2. Global secrets: ~/.inkos/secrets.json
  const globalSecrets = await loadGlobalSecrets();
  const globalEntry = globalSecrets.services[service];
  if (globalEntry?.apiKey) return globalEntry.apiKey;

  return null;
}

async function readGlobalSecretsRaw(): Promise<SecretsFile> {
  try {
    const raw = await readFile(GLOBAL_SECRETS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as SecretsFile;
    if (!parsed || typeof parsed !== "object" || !parsed.services) {
      return { services: {} };
    }
    return parsed;
  } catch {
    return { services: {} };
  }
}

export async function loadGlobalSecrets(): Promise<SecretsFile> {
  const raw = await readGlobalSecretsRaw();
  const { data, changed } = migrateLegacyServiceIds(raw);
  if (changed) await saveGlobalSecrets(data);
  return data;
}

export async function saveGlobalSecrets(secrets: SecretsFile): Promise<void> {
  const dir = join(homedir(), ".inkos");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, SECRETS_FILE),
    JSON.stringify(secrets, null, 2),
    "utf-8",
  );
}
