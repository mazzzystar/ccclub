import chalk from "chalk";
import ora from "ora";
import type { MemberProject, ProfileResponse } from "@ccclub/shared";
import {
  isValidProjectUrl,
  MAX_PROJECTS,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_URL_LENGTH,
} from "@ccclub/shared";
import { requireConfig } from "../config.js";
import { formatFetchError } from "../fetch-error.js";
import { theme } from "../theme.js";

export type ProjectListChange =
  | { ok: true; projects: MemberProject[]; removed?: MemberProject }
  | { ok: false; error: string };

/**
 * Add or update one project. Names are matched case-insensitively: adding a
 * name that is already listed re-points it instead of listing it twice, and
 * omitting the URL then leaves the existing link alone.
 * @internal exported for tests.
 */
export function withProjectAdded(
  projects: MemberProject[],
  rawName: string,
  rawUrl?: string,
): ProjectListChange {
  const name = rawName.trim();
  if (!name) {
    return { ok: false, error: "Project name cannot be empty." };
  }
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return { ok: false, error: `Project name is too long (max ${MAX_PROJECT_NAME_LENGTH} characters).` };
  }

  let url: string | undefined;
  if (rawUrl !== undefined) {
    url = rawUrl.trim();
    if (url.length > MAX_PROJECT_URL_LENGTH) {
      return { ok: false, error: `Project URL is too long (max ${MAX_PROJECT_URL_LENGTH} characters).` };
    }
    if (!isValidProjectUrl(url)) {
      return { ok: false, error: "Project URL must be a valid https:// URL" };
    }
  }

  const existing = projects.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing === -1 && projects.length >= MAX_PROJECTS) {
    return {
      ok: false,
      error: `You can list at most ${MAX_PROJECTS} projects. Remove one first: ccclub project remove <name>`,
    };
  }

  const next = projects.slice();
  const merged: MemberProject = { name };
  const keptUrl = url ?? (existing === -1 ? undefined : next[existing].url);
  if (keptUrl) merged.url = keptUrl;
  if (existing === -1) {
    next.push(merged);
  } else {
    next[existing] = merged;
  }
  return { ok: true, projects: next };
}

/** Drop one project by name, case-insensitively. @internal exported for tests. */
export function withProjectRemoved(projects: MemberProject[], rawName: string): ProjectListChange {
  const name = rawName.trim();
  const existing = projects.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing === -1) {
    return { ok: false, error: `No project named "${name}". See yours with: ccclub project list` };
  }
  const next = projects.slice();
  const [removed] = next.splice(existing, 1);
  return { ok: true, projects: next, removed };
}

function printProjects(projects: MemberProject[]): void {
  if (projects.length === 0) {
    console.log(chalk.dim("  No projects yet."));
    console.log(chalk.dim("  Add one: ") + chalk.white("ccclub project add <name> --url https://..."));
    console.log();
    return;
  }
  for (const project of projects) {
    const link = project.url ? "  " + theme.link(project.url) : "";
    console.log(`  ${chalk.white(project.name)}${link}`);
  }
  console.log();
  console.log(chalk.dim(`  ${projects.length}/${MAX_PROJECTS} shown on the leaderboard.`));
  console.log();
}

/** The server owns the list; every subcommand reads it, mutates, writes back. */
async function fetchProjects(config: { apiUrl: string; token: string }): Promise<MemberProject[]> {
  const res = await fetch(`${config.apiUrl}/api/profile`, {
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error("failed to fetch profile");
  }
  const profile = (await res.json()) as ProfileResponse;
  return profile.projects || [];
}

async function saveProjects(
  config: { apiUrl: string; token: string },
  projects: MemberProject[],
): Promise<MemberProject[]> {
  const res = await fetch(`${config.apiUrl}/api/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ projects }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || "failed to update projects");
  }
  const profile = (await res.json()) as ProfileResponse;
  return profile.projects || [];
}

export async function projectAddCommand(name: string, options: { url?: string }): Promise<void> {
  const config = await requireConfig();

  const spinner = ora("Adding project...").start();
  try {
    const current = await fetchProjects(config);
    const change = withProjectAdded(current, name, options.url);
    if (!change.ok) {
      spinner.stop();
      console.log(chalk.red(`\n  ${change.error}`));
      console.log();
      return;
    }
    const saved = await saveProjects(config, change.projects);
    spinner.succeed(`Added "${name.trim()}"`);
    console.log();
    printProjects(saved);
  } catch (err) {
    spinner.fail(`Failed: ${formatFetchError(err)}`);
  }
}

export async function projectRemoveCommand(name: string): Promise<void> {
  const config = await requireConfig();

  const spinner = ora("Removing project...").start();
  try {
    const current = await fetchProjects(config);
    const change = withProjectRemoved(current, name);
    if (!change.ok) {
      spinner.stop();
      console.log(chalk.red(`\n  ${change.error}`));
      console.log();
      return;
    }
    const saved = await saveProjects(config, change.projects);
    spinner.succeed(`Removed "${change.removed ? change.removed.name : name.trim()}"`);
    console.log();
    printProjects(saved);
  } catch (err) {
    spinner.fail(`Failed: ${formatFetchError(err)}`);
  }
}

export async function projectListCommand(): Promise<void> {
  const config = await requireConfig();

  const spinner = ora("Fetching projects...").start();
  try {
    const projects = await fetchProjects(config);
    spinner.stop();
    console.log(chalk.bold("\n  Your Projects\n"));
    printProjects(projects);
  } catch (err) {
    spinner.fail(`Failed: ${formatFetchError(err)}`);
  }
}
