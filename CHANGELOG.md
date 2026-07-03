# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses semantic versioning.

## [1.0.0] - 2026-07-03

### Added

- First stable public release of Nexus Messenger.
- Self-hosted Docker Compose deployment path with PostgreSQL and Redis.
- Real-time direct and group messaging, media/file sharing, voice messages, reactions, read receipts, presence, typing indicators, and admin/root flows.
- English and Persian public README files.
- Public release metadata, MIT license, contribution guide, security policy, changelog, and basic GitHub Actions CI.

### Changed

- Normalized package metadata and version declarations to 1.0.0.
- Reworked public documentation to describe Docker Compose as the canonical v1.0.0 deployment path.
- Replaced old product identity references with Nexus Messenger.

### Fixed

- Removed corrupted legacy architecture notes from the public repository.
- Cleaned known mojibake/encoding artifacts in release-facing files.

### Security

- Removed internal agent workflow files and private deployment notes from the public tree.
- Added public repository ignore rules for internal AI/agent workspaces and private environment files.
- Added security reporting and production hardening guidance.

### Documentation

- Added transparent AI-assisted project story.
- Added production security checklist, known limitations, roadmap, and environment setup guidance.

