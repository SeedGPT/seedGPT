# Self-Evolving Agent

Welcome to seedGPT, an experimental project which aims to create a autonomous self-improving LLM agent capable of generating and improving its own codebase.

## Features

- Reads tasks from `tasks.json`
- Uses an LLM to generate code patches
- Applies patches, commits, pushes branches, and opens PRs via Octokit
- CI: GitHub Actions (build, test, lint)
- CD: Argo CD (GitOps deployment to Kubernetes)
