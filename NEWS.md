# Apple Notes MCP — Implementation Plan and Running Log

This document tracks goals, features, decisions, wall-hits, and compact summaries across iterations. It is the single source of truth for the roadmap and status.

## Vision & Scope

- Provide a simple, secure, local-only MCP server for Apple Notes on macOS.
- Enable AIs/agents to: create/edit/read/format notes, manage folders/subfolders, manage checklists, and delete content as needed.
- Keep implementation minimal and idiomatic. Prefer JXA/AppleScript for native control.

## Feature Matrix (Target)

- Folders
  - Create/ensure path (nested)
  - List all folders (id, name, account)
  - Delete folder by path
  - Rename folder
  - List folder contents by path (notes + subfolders)
- Notes
  - Create in folder (title/body)
  - Read by id (title/body/modified/folder)
  - Update (title/body, append text)
  - Move between folders (id or path)
  - Format (basic HTML transforms: bold/italic/monospace for body)
  - Add checklist items (append checklist HTML)
  - Toggle/remove checklist items by index
  - Add hyperlink
  - Search by name or body

## Security & Privacy

- Local only: uses `osascript` (JXA/AppleScript). No network I/O.
- Minimal permissions: requires Automation permission to control Notes.
- Tools avoid broad destructive operations by default; deletes are explicit and path-scoped.

## Design Decisions

- Use MCP `text` content blocks with JSON string payloads for maximum compatibility.
- Prefer AppleScript for some folder operations (create/delete) due to JXA coercion quirks.
- Represent checklists using HTML appended to note bodies; Apple Notes stores note bodies as HTML.

## Known Limitations / Wall Hits

- JXA `make` for folders can error with “Can’t convert types” in some contexts; AppleScript path-based creation is more reliable.
- Checklist representation is not officially documented; implemented as HTML with checkboxes. If rendering differs, we’ll adjust.
- Complex formatting (ranges/selection) isn’t supported via scripting; we apply whole-body transforms or append fragments.

## Implementation Plan (Phases)

1. Core Folder/Note ops
   - folders.create (nested path)
   - folders.delete (path)
   - notes.create, notes.get, notes.list, notes.update, notes.delete
2. Checklists and Text helpers
   - notes.add_checklist (append HTML checklist)
   - notes.append_text (append plain text to body)
3. Formatting
   - notes.apply_format: bold_all, italic_all, monospace_all, or wrap fragment
4. Docs & Tooling
   - README updates, examples, dev scripts
   - Security notes

## Current Status (Compact)

- Done: Core CRUD for notes; list/ensure/delete/rename folders; move note; folder contents; append text; add/toggle/remove checklist; basic formatting; add link; search; repo published.
- Next: Structured output schemas; safe-mode toggles; more formatting helpers; improve checklist parsing robustness; richer docs.

## Iteration Log

### Iteration 1

- Implemented server with tools: list_folders, list, get, create, update, delete; folders.ensure.
- Added client script to demo creating folder and note.
- Decision: Use AppleScript for folder ops where JXA fails.
- Next: add delete folder, checklist, formatting, docs.

### Iteration 2

- Added: folders.delete, notes.append_text, notes.add_checklist, notes.apply_format.
- Decision: Keep JSON-in-text for broad compatibility; plan to add structuredContent next.

### Iteration 3

- Added: notes.move, folders.rename, folders.contents, notes.search, notes.add_link, notes.toggle_checklist, notes.remove_checklist.
- Limits: Attachments (images/files), tags, lock/pin/sharing not reliably scriptable via Notes Scripting; left as out-of-scope for now.
- Next: Add structuredContent schemas; safety annotations and read-only mode; expand README examples.

### Iteration 4

- Structured outputs: All tools now return structuredContent with Zod schemas.
- Safe mode: Global read-only toggle via env `NOTES_MCP_SAFE=1` or tool `server.set_safe_mode`.
- Safety annotations: Tools annotated with readOnly/destructive/idempotent hints.
- Concurrency: Body search uses bounded concurrency for better performance.
- Next: Optional task-based tooling for long-running ops; richer examples; CI.
