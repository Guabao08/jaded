# Jaded

Jaded markets developers' apps on social media with little effort from them. It connects to a developer's GitHub repository and App Store / Google Play listing, turns meaningful pushes into posts, and (in later phases) publishes them to the developer's own social accounts after they approve each one.

- **The app:** [`app/`](app/), a Next.js + TypeScript project. Setup, commands and layout are in [`app/README.md`](app/README.md).
- **The plan:** [`PLAN.md`](PLAN.md), built one phase at a time.
- **Security:** [`SECURITY.md`](SECURITY.md) covers what data is stored, how it's protected, and how to report a vulnerability.
- **Design:** [`DESIGN.md`](DESIGN.md) has the visual language the dashboard follows.

## Quick start

Requires Node.js 20.12 or later.

```sh
cd app
npm install
cp .env.example .env        # then fill it in (see app/README.md)
npm run dev:local           # starts the local database, applies migrations, runs the app at http://localhost:3000
```
