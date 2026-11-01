# Relay - Evidence Handover

Relay turns project notes and work records into an editable handover draft. Each item keeps a link to the source file and line range. A reviewer checks every item before the approved handover is shown to the incoming teammate.

## Live project and source code

- **Working project:** [evidence-handover.onrender.com](https://evidence-handover.onrender.com)
- **Public source repository:** [github.com/krishiscapishi/evidence-handover](https://github.com/krishiscapishi/evidence-handover)

## Try the demo

1. Open the live project and choose **Explore the demo** to load the synthetic Atlas university pilot.
2. Review the 10 draft items. Open each source citation to inspect the original record and line numbers.
3. Edit, approve, or reject an item. Every item needs a review decision before sharing.
4. Choose **Approve and share handover** to open the approved recipient view.

The reviewer and recipient are demonstration views, not separate authenticated accounts. Use only the included synthetic sample or other records you are authorized to share.

## Round 2 verification

The deployed sample flow was checked in a browser on 2 November 2026: the sample loaded with 3 sources and 10 items, citations remained visible through review, all 10 items received a review decision, and the final recipient view showed the approved items with citations. A separate local API check verified synthetic file upload, citations, and saved edits. The live browser upload path and optional LLM request were not part of that smoke check.

## Technology and data flow

- **Frontend:** Vanilla HTML, CSS, and JavaScript.
- **Backend:** Python standard-library HTTP server and JSON APIs.
- **Storage:** SQLite, with one active demo project.
- **Extraction:** Rule-based candidate extraction works without an API key.
- **Optional AI:** The server contains an OpenAI-compatible retrieval-and-generation path. When configured, it retrieves relevant source chunks, sends them with the request, and validates returned file and line citations. No model provider is configured in the public demo; this path is unverified there.
- **Citations:** Source filename and line range stay attached to each handover item.

## Run locally

Requires Python 3.10 or later. The local fallback uses only the Python standard library.

```powershell
python server.py
```

Open `http://localhost:8000`. Choose **Explore the demo** to load the sample workspace, or **Create a handover** to upload `.txt`, `.md`, or `.csv` project records. The SQLite database is created as `handover.db` beside the server. Set `HANDOVER_DB` to place it elsewhere. Use **Start over** in the app to clear the current workspace.

## Hosting note

The project is deployed as a Render free web service. Free web services can spin down after 15 minutes without incoming traffic, and their local filesystem is ephemeral. The app stores its demo state in SQLite, so data can reset after the service restarts. If the page is waking, allow a short delay and choose **Explore the demo** to reload the sample. See [Render free instance limits](https://render.com/docs/free) and [Render's first deploy guide](https://render.com/docs/your-first-deploy).

## Optional AI configuration

The server reads `LLM_API_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` from server-side environment variables. The public demo does not have a key configured. Keep credentials in the hosting provider's secret settings; never commit them or put them in browser code. If no model settings are present or the request fails, the app uses its rule-based fallback and reports the fallback status.

## Scope limits

- Uploads are limited to `.txt`, `.md`, and `.csv`; PDF and office document parsing are not implemented.
- The app stores one active project in SQLite for this demo.
- Reviewer and recipient are in-app views, not server-enforced roles or real account authentication.
- There is no dedicated uncertainty or conflict detector; citations and human review are the safeguards in this prototype.
- The demo has no live Slack, GitHub, Jira, or Google Workspace connectors.
- The built-in extractor is rule-based. Do not describe AI extraction as active unless a provider has been configured and a real request succeeds.
- Use synthetic or approved records on the public service.

## Three substantial Round 3 improvements

1. Add authenticated, incremental source sync for GitHub and one team discussion source, with refresh and conflict handling.
2. Add user accounts, server-enforced roles, reviewer assignment, approval history, and an audit trail across projects.
3. Measure onboarding time and unresolved work against a baseline, then use reviewer corrections and recipient feedback to improve handover quality.
