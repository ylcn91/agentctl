import { join } from "node:path";
import { atomicRead, atomicWrite } from "./file-store";

export interface ExternalLink {
  id: string;
  provider: "github";
  type: "issue" | "pr";
  url: string;
  externalId: string; // "owner/repo#123"
  taskId: string;
  createdAt: string;
}

function getLinksPath(): string {
  const hubDir = process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
  return join(hubDir, "external-links.json");
}

async function readLinks(): Promise<ExternalLink[]> {
  const data = await atomicRead<ExternalLink[]>(getLinksPath());
  return Array.isArray(data) ? data : [];
}

async function writeLinks(links: ExternalLink[]): Promise<void> {
  await atomicWrite(getLinksPath(), links);
}

export async function addLink(
  link: Omit<ExternalLink, "id" | "createdAt">
): Promise<ExternalLink> {
  const links = await readLinks();
  const newLink: ExternalLink = {
    ...link,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  links.push(newLink);
  await writeLinks(links);
  return newLink;
}

export async function getLinksForTask(taskId: string): Promise<ExternalLink[]> {
  const links = await readLinks();
  return links.filter((l) => l.taskId === taskId);
}

export async function getAllLinks(): Promise<ExternalLink[]> {
  return await readLinks();
}

export async function removeLink(id: string): Promise<boolean> {
  const links = await readLinks();
  const idx = links.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  links.splice(idx, 1);
  await writeLinks(links);
  return true;
}
