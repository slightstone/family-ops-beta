# Actual organizer command shapes

These are `edit_kids_board.change` values. Use the tool's live schema; unsupported fields are rejected. The outer request is `{operation_id:<UUID>,workspace_id:<saved UUID>,expected_revision:<current integer>,change:<below>}`. Editors require grant_id and grant_revision from their current board access. Owners alone may change interview, tabs or source-backed work.

## Parent-entered items

`{type:"parentItem",command:{action:"create",definition:{category,title,childIds,date,notes,tasks,event?}}}`

- category: task | homework | test | reminder | preparation.
- title:1–200 characters. childIds: exact saved UUIDs, [] means Family. date: valid YYYY-MM-DD or "". notes: supplied text or "".
- tasks:[] unless the parent explicitly requested checklist work. Each new task is `{title,childId:<saved UUID or "">,due:<date or "">}`. Child assignments must belong to the selected item people, or Family. Unknown due stays "".
- category task uses tasks:[] and zero/one child. Server creates the one canonical task from item title/person/date; do not append another task or use legacy task/context title edits.
- Optional event is `{startTime:<HH:mm or "">,endTime:<HH:mm or "">,endDate:<date or "">,location:<supplied text or "">,timeZone:"Asia/Jerusalem"}`. Omit when no event details were supplied.

Edit: `{type:"parentItem",command:{action:"edit",contextId,definition:<full retained definition>}}`. Retain every existing checklist task ID by supplying `id` on those rows; preserve resolution/history. Do not silently delete checklist rows or move completed work to another person. A requested person change must clarify explicit checklist reassignment while retaining IDs/status. Standalone task title/date/person edits use this canonical path.

Review: `{type:"parentItem",command:{action:"review",contextId,review:"acknowledge"|"unacknowledge"|"clear"|"restore"}}`. These mean Seen/unseen/Archive/restore. Parent provenance is server-established: never supply parentEntry, sourceManagedTasks or ownership flags. Source-backed contexts cannot become manual items.

Task: `{type:"task",contextId,taskId,action:"acknowledge"|"done"|"reopen"|"dismiss"}`. Use exact saved task IDs. Done/Reopen is independent of item Seen/Archive. Editors may use these only on shared manual work.

## Manual activities/chugim

`{type:"parentActivity",command:{action:"add",effectiveFrom:<Israel date>,definition:{title,childId,schedule,startTime,endTime,location}}}`. One occurrence by default: schedule `{type:"once",date:<YYYY-MM-DD>}`. Weekly requires an explicit recurrence request: `{type:"weekly",days:[0..6],start:<date>,until:<date or null>}`; Sunday0 through Saturday6, unique days. Unknown clocks/place are "". End clock must follow start on the same day when both supplied.

Edit: command `{action:"edit",activityId,activityRevision,effectiveFrom,definition}`. End: `{action:"end",activityId,activityRevision,effectiveFrom}`. Read current activityRevision first; preserve older versions and completed sessions. An edit/end supersedes future definitions from effectiveFrom, never silently transfers completed child history.

One session: `{type:"parentActivity",command:{action:"session",activityId,day,proof:{childId,definitionRevision,occurrenceRevision},change}}`. Copy proof from parentActivities.sessions exactly; occurrenceRevision0 means absent. change is `{type:"complete"}`, `{type:"reopen"}` or `{type:"travel",direction:"outbound"|"return",mode:"walk_bike"|"we_drive"|"someone_else"|null}`. Travel needs direct parent instruction. No Google effect.

## Existing tabs (owner only)

`{type:"boardPreferences",preferences:{schemaVersion:1,labels:{today:<string or null>,updates:<string or null>,activities:<string or null>},order:[<all three stable IDs exactly once>],defaultSection:<one stable ID>}}`.

Read full current preferences first; preserve untouched settings. Labels:1–24 single-line characters, distinct effective names; null restores the default. Stable today/updates/activities IDs keep their workflows. This supports labels, order and opening tab only; no arbitrary CSS, new module/platform, paid unlock or changed permissions.
