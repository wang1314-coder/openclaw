// Lists current-target production packages for Docker's offline prune store seed.
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
const roots = Array.isArray(parsed) ? parsed : [parsed];
const specs = new Set();
const target = {
  cpu: process.arch,
  libc: detectLibc(),
  os: process.platform,
};

// Seed only packages whose lockfile platform metadata matches this build. The
// `pnpm store add` that consumes this list exists solely to satisfy the offline
// `pnpm prune` that immediately follows, and that prune is already scoped to the
// target os/cpu (Dockerfile `--config.supportedArchitectures.*`). Seeding
// tarballs for other platforms is wasted network that can time out the build.
// We only drop packages this platform's prune also drops, so the seed stays a
// superset of what prune keeps and no needed package is lost. libc is left to
// prune (keeping all libc variants here only over-seeds, never under-seeds).
//
// `matchesList` mirrors npm/pnpm `checkList` (npm-install-checks): "any" always
// matches; "!x" denies value x; a list with positive entries requires a
// positive match; an all-negation list matches anything not explicitly denied.
function matchesList(value, list) {
  if (list.length === 1 && list[0] === "any") {
    return true;
  }
  let negated = 0;
  let match = false;
  for (const entry of list) {
    if (typeof entry !== "string") {
      continue;
    }
    if (entry.charAt(0) === "!") {
      negated += 1;
      if (entry.slice(1) === value) {
        return false;
      }
    } else if (entry === value) {
      match = true;
    }
  }
  return match || negated === list.length;
}

function matchesBuildPlatform(meta) {
  if (!meta) {
    return true;
  }
  if (Array.isArray(meta.os) && meta.os.length > 0 && !matchesList(process.platform, meta.os)) {
    return false;
  }
  if (Array.isArray(meta.cpu) && meta.cpu.length > 0 && !matchesList(process.arch, meta.cpu)) {
    return false;
  }
  return true;
}

function packageSpec(name, version) {
  if (!name || !version || typeof version !== "string") {
    return undefined;
  }
  const normalizedVersion = version.replace(/\(.+\)$/, "");
  if (
    normalizedVersion.startsWith("file:") ||
    normalizedVersion.startsWith("link:") ||
    normalizedVersion.startsWith("workspace:")
  ) {
    return undefined;
  }
  return `${name}@${normalizedVersion}`;
}

function detectLibc() {
  if (process.platform !== "linux") {
    return undefined;
  }
  const report = process.report?.getReport?.();
  return report?.header?.glibcVersionRuntime ? "glibc" : "musl";
}

function matchesTargetSelector(selector, value) {
  if (!Array.isArray(selector) || !value) {
    return true;
  }
  const blocked = selector.some((entry) => entry === `!${value}`);
  if (blocked) {
    return false;
  }
  const allowed = selector.filter((entry) => typeof entry === "string" && !entry.startsWith("!"));
  return allowed.length === 0 || allowed.includes(value);
}

function packageEntryForSpec(lockfile, spec) {
  return lockfile?.packages?.[spec] ?? lockfile?.packages?.[`/${spec}`];
}

function normalizeLockfilePackageKey(key) {
  if (typeof key !== "string") {
    return undefined;
  }
  return (key.startsWith("/") ? key.slice(1) : key).replace(/\(.+\)$/, "");
}

function snapshotForSpec(lockfile, spec) {
  const snapshots = lockfile?.snapshots;
  if (!snapshots) {
    return undefined;
  }
  return (
    snapshots[spec] ??
    snapshots[`/${spec}`] ??
    Object.entries(snapshots).find(([key]) => normalizeLockfilePackageKey(key) === spec)?.[1]
  );
}

function packageSupportsTarget(lockfile, spec) {
  const entry = packageEntryForSpec(lockfile, spec);
  return (
    matchesTargetSelector(entry?.os, target.os) &&
    matchesTargetSelector(entry?.cpu, target.cpu) &&
    matchesTargetSelector(entry?.libc, target.libc)
  );
}

function addSpec(lockfile, spec) {
  if (spec && packageSupportsTarget(lockfile, spec)) {
    specs.add(spec);
  }
}

function visitListNode(lockfile, node) {
  for (const dep of Object.values(node.dependencies ?? {})) {
    const name = dep.from || dep.name;
    const spec = packageSpec(name, dep.version);
    if (spec && dep.resolved?.startsWith("https://registry.npmjs.org/")) {
      addSpec(lockfile, spec);
    }
    visitListNode(lockfile, dep);
  }
}

function readLockfile() {
  const lockfilePath = path.join(process.cwd(), "pnpm-lock.yaml");
  if (!fs.existsSync(lockfilePath)) {
    return undefined;
  }
  return parse(fs.readFileSync(lockfilePath, "utf8"));
}

function addSnapshotClosure(lockfile) {
  const snapshots = lockfile?.snapshots;
  const packages = lockfile?.packages;
  if (!snapshots || !packages) {
    return;
  }
  const pending = [...specs];
  const visited = new Set();
  while (pending.length > 0) {
    const spec = pending.pop();
    if (!spec || visited.has(spec)) {
      continue;
    }
    visited.add(spec);
    const snapshot = snapshotForSpec(lockfile, spec);
    if (!snapshot) {
      continue;
    }
    const addDependencySpec = (name, version) => {
      const depSpec = packageSpec(name, typeof version === "string" ? version : version?.version);
      if (
        !depSpec ||
        !packages[depSpec] ||
        specs.has(depSpec) ||
        !packageSupportsTarget(lockfile, depSpec)
      ) {
        return;
      }
      specs.add(depSpec);
      pending.push(depSpec);
    };
    for (const [name, version] of Object.entries(snapshot.dependencies ?? {})) {
      addDependencySpec(name, version);
    }
    for (const [name, version] of Object.entries(snapshot.optionalDependencies ?? {})) {
      addDependencySpec(name, version);
    }
  }
}

const lockfile = readLockfile();
for (const root of roots) {
  visitListNode(lockfile, root);
}
addSnapshotClosure(lockfile);

const outputSpecs = [...specs].filter((spec) => matchesBuildPlatform(lockfile?.packages?.[spec]));
process.stdout.write(outputSpecs.toSorted((a, b) => a.localeCompare(b)).join("\n"));
