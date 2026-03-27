#!/usr/bin/env node

import { resolveReleaseState } from "./release-shared.mjs";

const releaseState = await resolveReleaseState();

process.stdout.write(`version=${releaseState.version}\n`);
process.stdout.write(`tag=${releaseState.tag}\n`);
process.stdout.write(`already_tagged=${releaseState.alreadyTagged ? "true" : "false"}\n`);
process.stdout.write(`base_version=${releaseState.baseVersion}\n`);
