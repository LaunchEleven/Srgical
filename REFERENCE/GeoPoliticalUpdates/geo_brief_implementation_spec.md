# GeoBrief — Comprehensive Implementation Specification (Delta-Aware, Trigger-Agnostic Edition)

## 1. Purpose

GeoBrief is a repository-driven geopolitical briefing system that can be triggered on any schedule or manually at any time. Each run gathers the freshest available evidence, compares it with prior generated briefs, identifies what is new versus continuing, and produces a narrative-ready briefing from an Australian perspective.

The system is designed to support a human commentator creating short daily or intra-day geopolitical briefings for YouTube and a public website. The generated written brief is the canonical editorial artifact. The public site is the archive and reading interface. Git history preserves the evolution of the narrative over time.

This document is an implementation specification for a code-first agent. It defines architecture, workflows, repository structure, source models, delta logic, ranking rules, evidence presentation, publication flow, and phased delivery.

---

## 2. Core design philosophy

### 2.1 Primary principle

The triggering mechanism should not determine editorial semantics.

Cron, manual dispatch, and future trigger types are merely ways to start the pipeline. The brief generation engine should not care whether a run happened because it was the morning slot, an hourly poll, or a manually invoked action. It should always do the same conceptual job:

1. collect the freshest available information,
2. compare against previous generated state,
3. identify what is new, updated, continuing, or no longer important,
4. generate a coherent current brief.

### 2.2 Consequences of this design

The system must be:

- **trigger-agnostic**
- **delta-aware**
- **freshness-sensitive**
- **continuity-aware**
- **editorially transparent**

### 2.3 Editorial objective

Each new brief should answer:

- What is happening now?
- What changed since the last update?
- What remains important even if it is not new?
- Why does it matter from an Australian perspective?
- What evidence supports these claims?

---

## 3. Product goals

### 3.1 Core goals

The system must:

1. be runnable on any schedule or manually;
2. collect geopolitical developments from configurable sources;
3. capture supporting evidence from mainstream reporting, official sources, and watched social accounts;
4. compare against previous briefs to compute story deltas;
5. rank developments by significance, Australian relevance, evidence strength, and freshness;
6. clearly mark stories as new, updated, or continuing;
7. generate a markdown brief suitable for a 10–15 minute spoken rundown;
8. produce machine-readable metadata and evidence bundles;
9. store all outputs in Git;
10. open or update a pull request for editorial review;
11. publish approved briefs to a public site;
12. preserve provenance and evidence for auditing and later refinement.

### 3.2 Non-goals

The system is not initially required to:

1. fully automate final political interpretation;
2. replace human editorial judgment for sensitive or disputed stories;
3. verify all social claims automatically with perfect reliability;
4. operate as a minute-by-minute breaking-news wire;
5. provide a database-backed CMS in v1;
6. generate the final YouTube video.

### 3.3 Editorial philosophy

The brief should behave like a serious, source-backed geopolitical update. It should:

- prioritize strategically meaningful developments;
- explain Australian significance explicitly;
- separate evidence classes clearly;
- favor the freshest high-trust evidence;
- repeat ongoing stories only when contextually justified;
- label repeated stories honestly as continuing or updated;
- avoid presenting previously mentioned items as if they are new.

---

## 4. Primary user and usage pattern

### 4.1 Primary user

A human commentator who:

- wants a clean daily or intra-day brief,
- records YouTube videos from it,
- wants a public archive,
- wants to expand and tune source watchlists over time.

### 4.2 Usage pattern

1. A trigger fires: cron, manual dispatch, or later another event source.
2. The pipeline collects fresh source material.
3. The pipeline loads the previous brief state.
4. The pipeline computes deltas and continuity.
5. The pipeline generates a fresh brief and evidence artifacts.
6. The pipeline writes outputs to the repo.
7. The pipeline creates or updates a PR.
8. The human reviews and merges.
9. The public site republishes.
10. The human uses the page as the video rundown.

---

## 5. System architecture

The platform should be implemented as a static-first, repo-centric pipeline.

### 5.1 Major subsystems

1. **Trigger layer**
   - starts runs but does not determine editorial semantics.

2. **Collector**
   - gathers raw source material.

3. **Normalizer**
   - maps heterogeneous inputs into a common schema.

4. **Deduplicator / Clusterer**
   - groups related items into candidate stories.

5. **Delta engine**
   - compares current clusters to prior brief state.

6. **Scorer / Ranker**
   - scores stories by significance, freshness, Australian relevance, evidence strength, and continuity.

7. **Brief Composer**
   - produces human-readable and machine-readable briefing artifacts.

8. **Evidence Presenter**
   - generates renderable bundles for embeds, snippets, and highlighted support.

9. **Repository Writer**
   - writes artifacts to dated paths in Git.

10. **PR Orchestrator**
    - creates or updates the active brief PR.

11. **Publisher**
    - builds the public site from merged artifacts.

12. **Configuration Layer**
    - holds sources, watchlists, ranking weights, taxonomy, manual overrides, and output rules.

### 5.2 Suggested technology choices

Recommended baseline:

- **Language:** TypeScript on Node.js
- **Runtime:** Node 20+
- **Package manager:** npm or pnpm
- **Site framework:** Astro preferred
- **Validation:** Zod
- **Markdown processing:** unified / remark / rehype
- **Date handling:** Luxon or date-fns
- **HTTP client:** fetch / undici
- **Testing:** Vitest
- **Linting/formatting:** ESLint + Prettier
- **CI/CD:** GitHub Actions
- **Storage:** Git repository only for v1

Plain JavaScript is acceptable if the agent is optimizing for speed, but runtime schema validation is still required.

---

## 6. Repository structure

```text
geo-brief/
  briefs/
    2026/
      2026-04-12/
        brief.md
        metadata.json
        sources.json
        clusters.json
        delta.json
        evidence.json
        notes.md
  runs/
    2026/
      2026-04-12/
        2026-04-12T06-30-00+10-00/
          articles.json
          social.json
          officials.json
          normalized.json
          clusters.json
          delta.json
          run-report.json
          logs.json
        2026-04-12T13-00-00+10-00/
          ...
  configs/
    app.json
    source_registry.yaml
    ranking_rules.yaml
    geography_rules.yaml
    topic_taxonomy.yaml
    x_accounts.yaml
    truthsocial_accounts.yaml
    official_accounts.yaml
    editorial_overrides.yaml
    site_config.json
  src/
    domain/
    services/
    adapters/
    cli/
  site/
    src/
    public/
    astro.config.mjs
  .github/
    workflows/
      generate-brief.yml
      publish-site.yml
  tests/
    unit/
    integration/
    fixtures/
  package.json
  README.md
```

### 6.1 Directory roles

- `briefs/`: canonical latest artifact for each date, consumed by the site
- `runs/`: immutable per-run records for auditability and delta comparisons
- `configs/`: editorial and operational configuration
- `src/`: implementation
- `site/`: public frontend
- `.github/workflows/`: automation definitions

### 6.2 Canonical versus per-run output

Each run should write an immutable run record under `runs/`.
Then the system should regenerate the canonical brief for the date under `briefs/`.

This separation enables:

- historical inspection of each run,
- clean public rendering,
- stable comparison logic,
- easier debugging of how the brief evolved.

---

## 7. Trigger model

### 7.1 Trigger-agnostic design

The pipeline must not depend on named run slots like “morning” or “evening” for correctness.

Supported trigger types:

- scheduled cron run
- manual workflow dispatch
- local CLI invocation
- future webhook or event-driven trigger

### 7.2 Operational recommendation

Use cron as the wake-up mechanism. The run itself should simply generate a fresh brief from the current state of the world and prior artifacts.

### 7.3 Configurability

Cadence should be configurable at the workflow level, not hardcoded into business logic.

Examples:

- once daily
- twice daily
- three times daily
- hourly
- ad hoc manual runs

### 7.4 Manual runs

A manually triggered run must behave exactly like any other run. It should not require special code paths, except optional debug flags.

---

## 8. Source model

The system should operate on source classes rather than hardcoded fetch logic.

### 8.1 Source classes

1. **Mainstream reporting**
   - Reuters
   - AP
   - BBC
   - Financial Times
   - ABC Australia
   - other configured outlets

2. **Official institutional sources**
   - ministries of foreign affairs
   - defence departments
   - governments
   - NATO / EU / UN / DFAT / PM offices

3. **Watched social accounts**
   - official accounts
   - analysts
   - journalists
   - selected OSINT sources

4. **Optional political platform sources**
   - Truth Social
   - Telegram
   - YouTube community posts
   - think-tank feeds

### 8.2 Trust hierarchy

Default evidence trust order:

1. official primary statement
2. highly reputable wire or major outlet reporting
3. reputable analyst commentary citing evidence
4. fast OSINT / commentary sources
5. uncorroborated social claim

### 8.3 Declarative source configuration

All sources must be defined in configuration. The implementation must not require code changes to add or remove ordinary watched sources.

---

## 9. Watchlist model for X and other social feeds

### 9.1 Goals

The watchlist must:

- be easy to grow,
- distinguish official from interpretive accounts,
- support weighting and tagging,
- allow enabling/disabling,
- include notes and rationale.

### 9.2 Example schema

```yaml
lists:
  official:
    - handle: dfat
      platform: x
      enabled: true
      weight: 1.0
      tags: [australia, official, diplomacy]
      notes: Official Australian foreign affairs source

  analysts:
    - handle: some_analyst
      platform: x
      enabled: true
      weight: 0.75
      tags: [middle-east, strategy]
      notes: Useful interpretive commentary

  osint:
    - handle: some_osint_account
      platform: x
      enabled: true
      weight: 0.4
      tags: [ukraine, battlefield]
      notes: Fast but must be corroborated
```

### 9.3 Account metadata

Each watched account should support:

- `handle`
- `platform`
- `enabled`
- `weight`
- `tags`
- `category`
- `region_focus`
- `notes`
- `priority`
- `treat_as_primary_when_official`

### 9.4 Platform adapter abstraction

```ts
interface SocialSourceAdapter {
  fetchRecentPosts(account: SocialAccount, window: TimeWindow): Promise<NormalizedSocialPost[]>;
}
```

Do not hardwire the design to X alone.

---

## 10. Data contracts

All source material should be normalized into common internal models.

### 10.1 Normalized source item

```ts
interface NormalizedSourceItem {
  id: string;
  sourceType: 'news' | 'official' | 'social';
  platform?: 'web' | 'x' | 'truthsocial' | 'telegram';
  publisher: string;
  author?: string;
  title: string;
  url: string;
  publishedAt: string;
  fetchedAt: string;
  summary?: string;
  bodyText?: string;
  tags?: string[];
  regionHints?: string[];
  topicHints?: string[];
  confidence: number;
  evidenceClass: 'primary' | 'reported' | 'commentary' | 'uncorroborated';
  rawRef?: string;
}
```

### 10.2 Normalized social post

```ts
interface NormalizedSocialPost extends NormalizedSourceItem {
  accountHandle: string;
  accountDisplayName?: string;
  accountCategory: 'official' | 'analyst' | 'journalist' | 'osint' | 'political';
  repostOfUrl?: string;
  quotedUrls?: string[];
}
```

### 10.3 Story cluster

```ts
interface StoryCluster {
  id: string;
  titleCandidate: string;
  summaryCandidate: string;
  topicTags: string[];
  geographyTags: string[];
  items: NormalizedSourceItem[];
  primaryEvidence: NormalizedSourceItem[];
  socialSignals: NormalizedSourceItem[];
  scoreBreakdown: ScoreBreakdown;
  australianAngle?: string;
  editorialFlags: string[];
}
```

### 10.4 Score breakdown

```ts
interface ScoreBreakdown {
  recency: number;
  globalSignificance: number;
  australianRelevance: number;
  sourceStrength: number;
  continuity: number;
  economicImpact: number;
  defenceImpact: number;
  audienceInterest: number;
  socialHeat: number;
  total: number;
}
```

### 10.5 Delta model

```ts
interface StoryDelta {
  clusterId: string;
  status: 'new' | 'updated' | 'continuing' | 'dropped';
  previousClusterId?: string;
  previousRank?: number;
  currentRank?: number;
  changeSummary?: string;
  newlyAddedEvidenceIds?: string[];
  removedEvidenceIds?: string[];
  significanceOfChange?: 'major' | 'moderate' | 'minor';
}
```

### 10.6 Daily brief model

```ts
interface DailyBrief {
  date: string;
  generatedAt: string;
  comparedTo?: string;
  headlineSummary: string;
  sincePreviousUpdate: BriefChangeSummary[];
  stories: BriefStory[];
  watchlistMentions: WatchlistMention[];
  editorialNotes?: string[];
  runRef: string;
}
```

### 10.7 Brief story model

```ts
interface BriefStory {
  rank: number;
  clusterId: string;
  deltaStatus: 'new' | 'updated' | 'continuing';
  title: string;
  summary: string;
  whyItMatters: string;
  australiaAngle: string;
  whatChanged?: string;
  confidenceLabel: 'high' | 'medium' | 'low';
  sourceUrls: string[];
  primarySourceUrls: string[];
  socialSourceUrls: string[];
  topicTags: string[];
  geographyTags: string[];
}
```

### 10.8 Change summary model

```ts
interface BriefChangeSummary {
  status: 'new' | 'updated' | 'continuing';
  clusterId: string;
  title: string;
  summary: string;
}
```

---

## 11. Ingestion requirements

### 11.1 News ingestion

The collector should support RSS, APIs, and public pages where practical. It should:

- fetch within a configurable rolling window,
- extract title, URL, publisher, timestamp, and summary/body where possible,
- discard clearly stale or irrelevant results,
- retain source references for later evidence mapping.

### 11.2 Official source ingestion

Official sources should be treated as high-trust evidence. Monitor official sites or feeds and preserve direct statements where possible.

### 11.3 Social ingestion

In v1 or v2, social collection should focus on the watched-account lists rather than broad search. This keeps the signal controlled and auditable.

The collector should:

- fetch recent posts for watched accounts,
- preserve canonical URLs,
- capture quoted links,
- classify posts as statement, commentary, repost, or signal,
- avoid treating engagement metrics as truth.

### 11.4 Rolling time window

The system should ingest from a rolling recent window rather than a fixed named run period. Recommended defaults:

- canonical brief relevance window: previous 24 hours,
- freshness emphasis window: previous 6–12 hours,
- continuity reference window: previous brief plus optional prior-day carryover.

---

## 12. Normalization and enrichment

The system should enrich raw inputs with lightweight derived metadata.

### 12.1 Required enrichment

- topic classification
- geography classification
- entity extraction
- source reputation metadata
- evidence class
- baseline confidence

### 12.2 Topic taxonomy

Example categories:

- great-power competition
- middle-east conflict
- europe / russia / ukraine
- indo-pacific
- china / taiwan
- energy / shipping
- sanctions / trade
- domestic political shifts with geopolitical consequence
- defence procurement / force posture

### 12.3 Geography tags

Example tags:

- australia
- us
- china
- taiwan
- iran
- israel
- ukraine
- russia
- eu
- middle-east
- indo-pacific
- global-energy

---

## 13. Deduplication and clustering

### 13.1 Purpose

Multiple sources will describe the same underlying development. These must be clustered into story-level entities.

### 13.2 Deduplication rules

Deduplicate using:

- identical URLs,
- highly similar titles,
- same publisher + timestamp + title similarity,
- same social post or repost lineage.

### 13.3 Clustering approach

Initial clustering may use:

- named entity overlap,
- geography overlap,
- topic overlap,
- event keyword similarity,
- embedding similarity if available.

### 13.4 Stable cluster identity requirement

Because the system is delta-aware, cluster identity should be as stable as possible across runs. The implementation should attempt to match current clusters to previous clusters using:

- title similarity,
- entity overlap,
- topic/geography similarity,
- evidence-source overlap,
- optional embedding similarity.

This matching is essential for determining whether a story is new, updated, continuing, or dropped.

### 13.5 Cluster quality rules

Prefer clusters that have:

- at least one strong evidence item,
- corroboration where possible,
- coherent topic and geography,
- limited contradiction unless explicitly flagged.

---

## 14. Delta engine

### 14.1 Purpose

The delta engine compares the current run’s clusters to the previous generated brief state.

### 14.2 Required outputs

For each current cluster, determine whether it is:

- **new**: not present previously, or previously too weak to feature,
- **updated**: previously present and materially changed,
- **continuing**: previously present and still important, but without major new developments,
- **dropped**: previously present but no longer significant enough for the current brief.

### 14.3 Material change rules

A story should be classified as **updated** only if there is meaningful change, such as:

- a new official statement,
- new concrete numbers,
- confirmation of a previously uncertain claim,
- major geographic expansion,
- new sanctions/action/military move,
- visible economic consequence,
- Australian response or implication,
- a major contradiction from a trusted source.

It should not be classified as updated merely because:

- another outlet repeated the same facts,
- wording changed cosmetically,
- commentary repeated an already established narrative.

### 14.4 Continuity rules

A story may reappear in consecutive briefs only if at least one is true:

- it remains among the top-ranked active developments,
- it is required context for understanding a newer event,
- it is unresolved and strategically significant,
- it remains materially relevant to Australia.

### 14.5 Change summary generation

Each updated or continuing story should optionally carry a concise “what changed” or “why still here” explanation.

### 14.6 Since-previous-update section

Each brief should include a short orientation section summarizing:

- what is new,
- what materially changed,
- what remains central context.

This section is critical for users consuming multiple updates over time.

---

## 15. Ranking and scoring

### 15.1 Purpose

The ranker determines which clusters matter most now and in what order they should appear.

### 15.2 Scoring dimensions

Each cluster should be scored on:

1. **Recency**
2. **Global significance**
3. **Australian relevance**
4. **Source strength**
5. **Continuity importance**
6. **Economic impact**
7. **Defence/security impact**
8. **Audience salience**
9. **Social heat** as a weak supporting factor

### 15.3 Freshness principle

Freshness must be treated as “freshest high-trust evidence,” not merely “newest content.”

A minor new comment should not automatically outrank a major ongoing crisis. Likewise, a major ongoing story should not be repeated identically without a continuity rationale.

### 15.4 Australian relevance definition

Australian relevance includes:

- impact on fuel, shipping, inflation, or trade,
- alliance implications,
- Indo-Pacific strategic consequences,
- Australian government posture,
- implications for Australians abroad or regional security.

### 15.5 Example weights

```yaml
weights:
  recency: 0.15
  global_significance: 0.22
  australian_relevance: 0.22
  source_strength: 0.15
  continuity: 0.10
  economic_impact: 0.08
  defence_impact: 0.06
  audience_interest: 0.01
  social_heat: 0.01
```

### 15.6 Editorial overrides

The config layer should support:

- promotions,
- suppressions,
- manual review flags,
- topic prioritization,
- low-confidence demotion.

### 15.7 Confidence labels

Assign each story a confidence label:

- **high**: strong official and/or reputable reporting support
- **medium**: multiple reputable reports but still fluid
- **low**: early, contradictory, or weakly supported

Low-confidence items should generally not anchor the brief unless clearly marked provisional.

---

## 16. Evidence presentation and embedded support

### 16.1 Goal

The brief should present supporting evidence visually and editorially usefully. Where possible, the site should embed primary social posts and surface article snippets with highlighted supporting passages.

### 16.2 Evidence principles

The evidence layer must:

- show why a claim appears in the brief,
- distinguish evidence classes,
- avoid over-quoting copyrighted text,
- preserve attribution,
- support compact and expanded views,
- map claims to supporting evidence.

### 16.3 Supported evidence display types

1. **Embedded social post**
2. **Article evidence card**
3. **Official statement card**
4. **Evidence comparison block**

### 16.4 Claim-to-evidence mapping

```ts
interface ClaimEvidenceMap {
  claimId: string;
  claimText: string;
  supportingSourceItemIds: string[];
  highlightedPassages?: HighlightedPassage[];
}
```

### 16.5 Highlighted passage model

```ts
interface HighlightedPassage {
  sourceItemId: string;
  startOffset?: number;
  endOffset?: number;
  text: string;
  label?: string;
  type: 'quote' | 'paraphrase' | 'summary-highlight';
}
```

### 16.6 Article snippet policy

Prefer:

- short snippets,
- paraphrased summaries,
- headline + dek,
- very limited quotations,
- or machine-generated short summaries.

Do not reproduce long article bodies.

### 16.7 Social embed policy

Store:

- canonical URL,
- account metadata,
- post text,
- quoted URLs,
- embed reference or HTML when available.

If native embedding is unavailable, render a fallback social card.

### 16.8 Highlight generation strategy

Use one or more of:

- sentence scoring against claim text,
- semantic similarity,
- keyword overlap,
- optional LLM-assisted evidence selection later.

### 16.9 UI requirements

Each story page should support:

- inline compact evidence,
- expandable cards,
- embeds where available,
- highlighted supporting snippets,
- labels such as `Official`, `Reporting`, `Analysis`, `Unverified social signal`.

### 16.10 Presenter mode vs research mode

The site should support:

1. **Presenter mode**
   - low clutter
   - evidence minimized but expandable

2. **Research mode**
   - full evidence cards and embeds visible
   - highlights expanded

### 16.11 Fallback behavior

If a source cannot be embedded:

- render a styled link card,
- preserve attribution,
- show a short snippet or summary,
- preserve highlights if available.

---

## 17. Narrative composition

### 17.1 Goal

The brief should be a coherent rundown, not just a ranked list.

### 17.2 Required sections

Each brief should include:

1. Title / dateline
2. Coverage explanation
3. Executive summary
4. Since previous update
5. Ordered major developments
6. Australian implications section
7. Watchlist / social pulse section
8. Suggested narrative order for video
9. Source basket

### 17.3 Story entry requirements

Each story should include:

- delta badge: `New`, `Updated`, or `Continuing`
- headline/title
- concise description
- why it matters geopolitically
- why it matters to Australia
- what changed or why it remains central
- evidence links
- optional embedded-evidence references
- optional “what to watch next” note

### 17.4 Social watch section

A dedicated section should summarize watched-account commentary while clearly separating:

- official statements,
- analytical commentary,
- unverified claims.

### 17.5 Writing style

The generated brief should be:

- serious,
- clear,
- suitable for spoken delivery,
- explicit about uncertainty,
- not sensational,
- not written in first person.

---

## 18. Output artifacts

Each run should generate both human-readable and machine-readable outputs.

### 18.1 Canonical output files per date

#### `brief.md`
Human-readable dated briefing.

#### `metadata.json`
High-level metadata such as generation timestamp and comparison target.

#### `sources.json`
Normalized source items cited in the brief.

#### `clusters.json`
All scored story clusters.

#### `delta.json`
Delta classification and change summaries relative to the comparison target.

#### `evidence.json`
Story-level evidence bundles for site rendering.

#### `notes.md`
Optional editorial notes and warnings.

### 18.2 Per-run output files

Each run directory should preserve:

- raw fetched items,
- normalized items,
- intermediate clusters,
- delta results,
- run report,
- logs.

### 18.3 Example `metadata.json`

```json
{
  "date": "2026-04-12",
  "generatedAt": "2026-04-12T20:31:00+10:00",
  "comparedTo": "2026-04-12T13:02:00+10:00",
  "runRef": "runs/2026/2026-04-12/2026-04-12T20-31-00+10-00",
  "status": "draft"
}
```

### 18.4 Example `delta.json`

```json
{
  "generatedAt": "2026-04-12T20:31:00+10:00",
  "comparedTo": "2026-04-12T13:02:00+10:00",
  "storyDeltas": [
    {
      "clusterId": "cluster-hormuz-001",
      "status": "updated",
      "previousRank": 1,
      "currentRank": 1,
      "changeSummary": "New reporting on mine-clearing and shipping conditions.",
      "significanceOfChange": "major"
    },
    {
      "clusterId": "cluster-hungary-001",
      "status": "new",
      "currentRank": 3,
      "changeSummary": "Voting began in closely watched election.",
      "significanceOfChange": "moderate"
    }
  ]
}
```

### 18.5 Markdown frontmatter

```yaml
---
title: GeoBrief — 2026-04-12
slug: /briefs/2026/04/12/
date: 2026-04-12
status: draft
summary: Fragile U.S.–Iran talks dominate as Australia watches energy and shipping risk.
compared_to: 2026-04-12T13:02:00+10:00
run_ref: runs/2026/2026-04-12/2026-04-12T20-31-00+10-00
---
```

---

## 19. GitHub Actions workflow design

### 19.1 Workflow A — generate or refresh brief

File: `.github/workflows/generate-brief.yml`

Responsibilities:

1. trigger on schedule and manual dispatch;
2. check out repo;
3. install dependencies;
4. run collection pipeline;
5. identify comparison target;
6. compute clusters and deltas;
7. regenerate canonical date brief;
8. write immutable run artifacts;
9. create or update branch and PR.

### 19.2 Workflow B — publish site

File: `.github/workflows/publish-site.yml`

Responsibilities:

1. trigger on merge to main;
2. build static site;
3. publish to GitHub Pages or target host.

### 19.3 Workflow A behavior details

The workflow should:

- compute Melbourne-local current date/time,
- create a unique run directory based on actual run timestamp,
- load the most recent comparable prior brief,
- tolerate partial source failures,
- preserve prior run records,
- attach logs as artifacts when useful.

### 19.4 PR strategy

Use one evolving PR per date unless explicitly configured otherwise.

Branch naming:
- `brief/2026-04-12`

PR naming:
- `GeoBrief: 2026-04-12`

If a PR already exists for the date, update it.

### 19.5 PR body contents

Include:

- run timestamp,
- comparison target,
- top new stories,
- top updated stories,
- warnings,
- source counts,
- cluster counts.

### 19.6 Required permissions

The workflow needs:

- contents: write
- pull-requests: write

---

## 20. Website specification

### 20.1 Purpose

The site is the public archive and presenter-friendly reading interface.

### 20.2 Key pages

1. **Homepage**
   - latest brief
   - key developments
   - quick archive access

2. **Daily brief page**
   - full dated brief
   - delta markers
   - evidence cards and embeds
   - optional later video embed

3. **Archive page**
   - chronological list of briefs

4. **About page**
   - explains project and editorial purpose

5. **Methodology page**
   - explains evidence classes, trust hierarchy, and delta logic

### 20.3 Visual style

The site should feel like a polished briefing interface rather than a generic blog. Priorities:

- dark, calm, professional aesthetic,
- strong readable typography,
- excellent presenter readability,
- minimal clutter,
- clear date and hierarchy.

### 20.4 Rendering model

The site should be generated from the canonical `briefs/` artifacts and associated evidence bundles.

### 20.5 Optional future additions

- filters by region/topic,
- timeline view,
- “what changed since last brief” sidebar,
- map visualizations,
- recurring-theme tracking.

---

## 21. Editorial controls and manual adjustment points

The system must support manual influence without code edits.

### 21.1 Manual control files

Support files such as:

- `configs/editorial_overrides.yaml`
- `configs/manual_promotions.yaml`
- `configs/manual_suppressions.yaml`
- `configs/manual_notes.yaml`

### 21.2 Use cases

- force a story into top 3,
- suppress low-value noise,
- mark a story for manual review,
- add an editor note,
- pin continuity context,
- override delta classification in exceptional cases.

---

## 22. Error handling and resilience

### 22.1 Principle

The system should degrade gracefully.

### 22.2 Requirements

- If one source fails, continue.
- If social ingestion fails, still generate a brief.
- If clustering partially fails, preserve raw inputs and emit warnings.
- If PR creation fails, keep outputs as artifacts and committed changes if possible.
- Log enough detail for debugging.

### 22.3 Editorial warnings

If evidence is weak or contradictory, flag it and avoid automatically promoting it into the lead narrative.

---

## 23. Testing requirements

### 23.1 Unit tests

Cover:

- config loading,
- normalization,
- deduplication,
- cluster matching,
- delta classification,
- score calculation,
- markdown generation,
- evidence bundle generation.

### 23.2 Integration tests

Cover:

- end-to-end run with fixtures,
- manual trigger semantics,
- comparison to previous run,
- branch / PR orchestration in dry-run mode,
- site build from generated artifacts.

### 23.3 Golden-file tests

Use fixture-based golden tests for markdown and JSON outputs so narrative regressions are visible.

---

## 24. Security and secrets

### 24.1 Secret handling

Inject tokens via GitHub Actions secrets. Never commit them.

### 24.2 Potential secret categories

- news APIs,
- X credentials,
- Truth Social or scraping credentials,
- deployment credentials if not using Pages-native hosting.

### 24.3 Logging hygiene

No secret or token may appear in logs, artifacts, PRs, or the generated brief.

---

## 25. Observability and diagnostics

### 25.1 Required diagnostics

Each run should emit:

- sources fetched by class,
- deduplicated item count,
- cluster count,
- matched previous clusters,
- delta counts by status,
- top-ranked clusters,
- warnings,
- run duration.

### 25.2 Run report artifact

Produce a `run-report.json` file for each run.

---

## 26. Implementation phases

### Phase 1 — Minimal viable delta-aware pipeline

Deliver:

- repo scaffold,
- config loading,
- article ingestion for trusted sources,
- normalization,
- deduplication and clustering,
- previous-brief loading,
- basic delta classification,
- ranking,
- markdown + JSON outputs,
- PR creation/update.

### Phase 2 — Official and social evidence integration

Deliver:

- official-source adapters,
- watched social-account adapters,
- evidence classes,
- social pulse section,
- evidence bundle generation.

### Phase 3 — Public site

Deliver:

- static site,
- homepage/latest/archive pages,
- delta labels,
- evidence rendering,
- custom domain deployment.

### Phase 4 — Editorial refinement

Deliver:

- stronger cluster identity matching,
- better change summaries,
- manual promotions/suppressions,
- continuity scoring refinements,
- presenter/research modes.

### Phase 5 — Advanced enhancements

Potential later work:

- breaking-news trigger integration,
- entity memory across days,
- topic trend pages,
- map/timeline visuals,
- auto-generated teleprompter mode,
- automatic video rundown script generation.

---

## 27. Implementation checklist for the coding agent

1. Initialize repository structure.
2. Add schemas and config loaders.
3. Implement source registry.
4. Implement initial article collectors.
5. Implement normalization.
6. Implement deduplication and clustering.
7. Implement previous-brief lookup.
8. Implement cluster matching across runs.
9. Implement delta classification.
10. Implement scoring and ranking.
11. Implement markdown and JSON renderers.
12. Implement evidence bundle generation.
13. Implement dated canonical and per-run output writing.
14. Implement branch and PR orchestration.
15. Add scheduled and manual GitHub workflow.
16. Add tests and fixtures.
17. Add site scaffold consuming `briefs/`.
18. Add publish workflow.
19. Document local run and dry-run modes.

---

## 28. Acceptance criteria

The implementation is acceptable when:

1. A run can be triggered by cron or manually without semantic changes to business logic.
2. The system writes immutable per-run artifacts and regenerates canonical dated brief outputs.
3. The system compares against the previous brief and produces `delta.json`.
4. The generated brief clearly marks stories as new, updated, or continuing.
5. Repeated stories appear only with contextual justification.
6. The brief contains executive summary, since-previous-update, ordered developments, Australian implications, and evidence links.
7. The watchlist can be extended without code changes.
8. The site renders the archive and evidence-rich brief pages.
9. The system tolerates partial source failure.
10. Tests cover core normalization, delta classification, scoring, and rendering.

---

## 29. Suggested implementation defaults

Unless there is a strong reason otherwise, begin with:

- Node.js + TypeScript
- Astro for the site
- Zod for schemas
- GitHub Pages for hosting
- one PR per date
- cron-triggered workflow with optional manual dispatch
- article-first ingestion in v1
- watched-account integration in v2
- delta-aware brief generation from the beginning
- markdown + JSON outputs on every run

---

## 30. Final build intent

The end state should be a durable media-production system that produces:

- repository-native geopolitical briefs,
- evidence-backed and freshness-aware narratives,
- clear delta labeling across updates,
- explicit Australian framing,
- configurable source and social watchlists,
- public archival pages on a dedicated site,
- transparent provenance preserved in Git.

The human operator should be able to open the latest brief page, see what is new versus continuing, inspect the supporting evidence, add personal interpretation, and record a video with minimal friction.

