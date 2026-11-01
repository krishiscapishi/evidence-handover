# Relay — Evidence Handover

An early Round 2 demo for turning project records into a source-linked handover that a reviewer can edit and approve before sharing it with the incoming teammate.

## Run locally

Requires Python 3.10 or later. The demo uses only the Python standard library.

```powershell
python server.py
```

Open `http://localhost:8000`. Choose **Explore the demo** to load the sample Atlas pilot workspace, or **Create a handover** to upload your own `.txt`, `.md`, or `.csv` files. The included sample files contain synthetic project details.

The local SQLite database is created as `handover.db` beside the server. Set `HANDOVER_DB` to store it elsewhere. Use **Start over** in the app to clear the current workspace.

## Publish a judge link

The quickest no-cost route for this Python app is a Render web service connected to a GitHub repository. Create a GitHub account at [github.com/signup](https://github.com/signup), then make a **public** repository named `evidence-handover` so judges can open it. Upload only the files in this project folder; do not upload `.env` files, keys, or `handover.db`. GitHub's [new repository guide](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository) walks through the account and repository screens.

Render's current free web services sleep after 15 minutes without traffic, may take about a minute to wake, and lose local files when they sleep or restart. That means this demo's SQLite data is temporary on a free host; each judge should use **Explore the demo** to load the sample workspace. Render's official setup gives each web service a public `onrender.com` URL. See [Render's free plan limits](https://render.com/docs/free) and [first deploy guide](https://render.com/docs/your-first-deploy).

After the code is in GitHub:

1. In Render, create a **Web Service** and connect the repository.
2. Select **Python 3**. Use build command `pip install -r requirements.txt` and start command `python server.py`.
3. Choose the **Free** plan. The server reads Render's `PORT` value and binds to `0.0.0.0`.
4. Wait for the deploy to finish, open the generated URL, and click **Explore the demo**.

The public repository should contain only synthetic sample data. Add `LLM_API_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` as Render environment variables only after your team has confirmed an AI provider. Never commit the key.

## Demo journey

1. Open the seeded sample workspace or upload project records.
2. Build or review the draft items: decisions, tasks, risks, dependencies, and open questions.
3. Open each citation to inspect the original file and line numbers. Edit, approve, or reject every item.
4. Approve and share the handover, then open the incoming teammate view.

For best results with the built-in demo extraction, start source lines with `DECISION:`, `TASK:`, `RISK:`, `DEPENDENCY:`, or `QUESTION:`. Other lines are included when their wording matches conservative task, decision, risk, dependency, or question patterns.

## Optional AI extraction

The app has a retrieval grounded LLM path for an OpenAI-compatible chat completions endpoint. If your team has no existing key, Google's current Gemini API docs show a free developer tier for selected models and an OpenAI-compatible endpoint. For a demo with synthetic data, the settings below are a starting point:

```text
LLM_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=your-Gemini-API-key
LLM_MODEL=gemini-3.5-flash-lite
```

Create the key in Google AI Studio and add it to the hosting provider's server-side environment settings. Never paste the key into this chat or put it in `app.js`, HTML, or a committed file. The provider's free tier is limited and may change. Google's docs say free-tier content may be used to improve its products, so use synthetic demo records only. See [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) and [OpenAI-compatible setup](https://ai.google.dev/gemini-api/docs/openai/).

When these settings are absent, the demo uses its transparent, rule-based evidence candidate extractor. If an AI request fails, it falls back to that extractor and shows a notice.

The retrieval step ranks short source chunks by lexical overlap with handover topics, sends retrieved evidence to the configured model, and validates that each returned citation refers to a supplied source and line range. A human still reviews every result before sharing.

## Current scope and limits

- The upload flow accepts `.txt`, `.md`, and `.csv`; it does not parse PDF or office documents yet.
- The app stores one active project in SQLite for this demo.
- Reviewer and recipient are demonstration views in one browser. They are not real account authentication or server-enforced access controls.
- The app is intended for synthetic or approved sample data. Do not use confidential organizational records in a public demo.
- The demo does not connect to Slack, GitHub, Jira, or Google Workspace.
- The built-in extractor is not an LLM and should not be presented as one. Only describe AI extraction as active when the endpoint is configured and a real request succeeds.

## Round 3 opportunities

1. Add authenticated, read-only source connectors with incremental sync, starting with GitHub and one team discussion source.
2. Add team accounts, role-enforced access, approval history, and an audit trail across projects.
3. Add outcome tracking that measures onboarding time and unresolved work against a real baseline, then uses reviewer feedback to improve handover quality.
