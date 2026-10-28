---
name: setup
description: Set up or update Family Ops in the adult's own private Site, verify an existing installation, or save the initial family interview. Start here for a new Family board; use organizer for everyday items, activities and family access.
---

Family Ops uses the adult's native assistant and their own private Site database. No model API key or central family-data server. Read [capabilities](../../capabilities.json): local fictional acceptance is not independent-customer installation, directory approval, phone, Claude or cloud acceptance.

Before family questions or private reads, check this account's supported local execution/filesystem, installed Sites guidance, private Site/database deployment, generated connector and durable identity/reopen capabilities. Desktop local execution is required by this package; missing capabilities stop with a precise gap. Installation does not install Sites or establish hosting eligibility. The customer does not handle ZIPs, checksums, CLI commands, endpoints or config files.

For an existing installation, use only the adult-approved exact Site reference and verify identity before board access. Missing/ambiguous identity never authorizes a replacement. For new installation or a separately authorized update, follow [installation](references/installation.md), using supported native Sites actions and approval prompts. Preserve the Site, database, audience, runtime identity, connector and earlier work. Do not bypass a native control denial.

Installation approval is separate from family records, invitations, sources and schedules. After verified installation and permission to save the interview, call `get_kids_board({})`. Reuse saved answers and child IDs. Ask only missing child names/ages, preferred English/Hebrew and useful school/activity/exclusion details. `save_kids_interview` takes `{operation_id,expected_revision,workspace_id?,answers:{children:[{id?,name,age,school?,activities?}],language,exclusions?}}`; ages are integers0–21. First save uses revision0 and omits workspace_id. Existing children retain IDs. Save through this exact Site, then read back before saying saved.

Open the manual board with `edit_kids_board` using current workspace/revision and `change:{type:"manualStart"}` if needed. No source connection, examples or invented tasks are required. Use [organizer](../organizer/SKILL.md) for “Family board, add a test,” tasks, reminders, activities, supported tab labels/order and shared manual-board access.

WhatsApp, Google Calendar, email and Mashov are optional; this release implements no email/Mashov connector. Only on an explicit source request use [source setup](references/source-setup.md) and [kids-updates](../kids-updates/SKILL.md), or [kids-calendar](../kids-calendar/SKILL.md). Provider/native eligibility and charges are separate. Never collect authentication secrets in assistant prompts, outputs, files, screenshots or packaged data; use only the customer's protected host entry. Missing secure setup leaves optional features unavailable while the manual board works.

Retain exact operation/body/base after an ambiguous save. Reconcile identity/native effects as described in installation; never create a new Site/UUID/connector to bypass uncertainty. Report installation, saved interview, source processing and cloud execution as separate outcomes.
