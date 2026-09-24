# GitHub Actions workflows

These files belong in `.github/workflows/` at the repo root. They are stored
here because the current fine-grained PAT does not carry the `workflow`
scope, which GitHub requires to push files under `.github/workflows/`.

To activate CI + releases, EITHER:

    # (a) from a checkout with push rights, run:
    mkdir -p .github/workflows
    cp docs/workflows/ci.yml .github/workflows/ci.yml
    cp docs/workflows/release.yml .github/workflows/release.yml
    git add .github && git commit -m "ci: activate CI and release workflows" && git push

OR

    # (b) regenerate the token with the "Workflows" repository permission
    #     and ask the assistant to push them directly.

Contents:
- ci.yml — install → lint → drift guard → core tests (Node) → core tests
  (jest-expo/Hermes) → desktop tests (RTL) → desktop build, on push/PR
- release.yml — on tag v*: electron-builder (portable + nsis) published
  to a GitHub Release (unsigned; CSC discovery disabled)
