# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who build apps through code. They use ShipBrief when code pushes land and need relevant changes turned into marketing drafts.

## Product Purpose

ShipBrief helps app builders turn meaningful product changes into reviewable marketing content. Success means useful drafts are ready for human review when relevant code changes are pushed.

## Positioning

ShipBrief connects code changes to marketing drafts with linked evidence and human approval before publishing. It is designed to keep the person responsible for the message in control.

## Operating Context

The workflow begins when a push lands in a watched repository. A person reviews and can edit a draft before it is approved. Approval does not itself publish content.

## Capabilities and Constraints

- The current project is a local app. Sample repository selection and manually created demo content are stored in browser local storage. Signed GitHub push deliveries, their linked commit/compare evidence, and their drafts are stored in `.data/shipbrief.json`.
- The server verifies GitHub webhook signatures, deduplicates delivery IDs, accepts push events, and creates drafts for review. It listens on `127.0.0.1` by default and has no dashboard authentication; it must not be exposed publicly as-is.
- GitHub OAuth/App installation, public hosting, user accounts, and publishing integrations are not implemented. Pull request associations are fetched from the GitHub REST API when available; private repository access needs `GITHUB_API_TOKEN` until an installation-token flow exists.
- Push drafts use commit messages and related pull request titles as source material with a conservative local template. AI generation is not wired up; sample repository and change data remain illustrative.
- The prototype presents repository and pull request access as read-only and requires human approval. Treat these as prototype behavior, not confirmed production requirements; access enforcement is not implemented.
- The prototype's sample brand voice instructs drafts to avoid unsupported performance, customer outcome, or availability claims. Production policy is undecided.
- Whether production integrations or additional publishing channels are in scope remains undecided.

## Evidence on Hand

- The prototype in `public/` demonstrates overview, draft review, run history, repository selection, workflows, and brand voice settings.
- `README.md` documents current prototype behavior and integrations that are not wired up.
- Seed content and repository names are illustrative, not customer evidence. Do not present them as real testimonials, outcomes, or integrations.

## Product Principles

- Tie each draft to the product change that prompted it.
- Keep a person in control of review, edits, and approval.
- Keep a person in control of reviewing, editing, and approving drafts.
