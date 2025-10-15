# Agent Configuration for Talk Submission System

## Commands
- **No explicit test/lint commands** - Val Town platform handles these automatically
- **Development**: Val Town auto-deploys on changes, no local build needed
- **Database**: SQLite migrations run automatically on startup in backend/index.ts

## Architecture
- **Val Town Project**: Deno-based Discord bot for talk submissions with React frontend
- **Backend**: Hono API server (backend/index.ts) handling submissions and Discord integration
- **Frontend**: React 18.2.0 with TypeScript (frontend/index.tsx, components/)
- **Database**: SQLite with talk submissions table (talk_submissions_3)
- **Discord Integration**: Bot creates channels, sends notifications, generates invite links
- **Shared**: TypeScript types and utilities (shared/types.ts)

## Discord API Design Notes
- **Role Mentions**: Use `<@&ROLE_ID>` format in message content
- **User Mentions**: Use `<@USER_ID>` format in message content
- **Channel Mentions**: Use `<#CHANNEL_ID>` format in message content
- **Special Mentions**: `@everyone` and `@here` work as plain text (no ID needed)
- **Permissions**: Role must be mentionable OR bot needs "Mention Everyone" permission

## Code Style (from .cursorrules)
- **Language**: TypeScript/TSX with React 18.2.0
- **Imports**: Use `https://esm.sh` for npm packages, pin React to 18.2.0
- **Types**: Add TypeScript types for all data structures
- **Secrets**: Always use environment variables, never hardcode secrets
- **JSX**: Start React files with `/** @jsxImportSource https://esm.sh/react@18.2.0 */`
- **Styling**: Default to TailwindCSS via CDN script tag
- **Error Handling**: Let errors bubble up with context, avoid empty catch blocks
- **Database**: Change table names (e.g., _3, _4) when modifying schemas instead of ALTER TABLE
- **Platform**: Use Val Town utils for file operations (readFile, serveFile)
