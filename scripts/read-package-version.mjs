#!/usr/bin/env node

import { resolveReleaseState } from "./release-shared.mjs";

const releaseState = await resolveReleaseState();
process.stdout.write(releaseState.version);
