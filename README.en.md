# SciNode

[简体中文](README.md) | **English**

**A visual AI workspace for personal research.**

Turn a research request into an editable workflow, connect models with local tools, review decisions, and keep the inputs, configuration, and outputs of each run together.

**Define → Plan → Execute → Review → Export → Freeze**

[Why SciNode](#the-gap-scinode-bridges) · [Capabilities](#what-you-can-do) · [Requirements](#what-you-need) · [Setup](#configure-a-fresh-installation) · [First workflow](#run-your-first-workflow)

## The gap SciNode bridges

Research work often lives across chat histories, literature searches, analysis scripts, and local documents. Moving between them makes it hard to see what has finished, what needs approval, and which downstream results a change affects.

SciNode connects four parts of that workflow:

- **Conversation to an editable plan.** The assistant asks clarifying questions and proposes nodes, connections, layouts, and model choices. Review the changes before applying a draft.
- **Separate tools to visible dependencies.** Connect document readers, models, PubMed, Python/R, and MCP tools through their inputs and outputs. The canvas highlights active nodes, data transfer, pending decisions, and failures.
- **Generated material to a recorded decision.** Human-review nodes pause execution and present source material, revisions, and review notes. Approval or rejection becomes part of the run.
- **One-off output to a traceable research artifact.** Each run records its configuration, source inputs, actual model choices, logs, outputs, and decisions. Rerun from a selected node when work changes, then freeze reviewed artifacts.

Researchers own study definitions and scientific decisions; SciNode connects the tasks, tools, execution history, and deliverables around them.

## What you can do

- **Organize research projects:** group protocols and patents, literature reviews, clinical research, data analysis, and omics work; browse project versions and run history.
- **Build visual workflows:** add, remove, connect, and reuse nodes; start with research presets or write custom tasks; inspect configuration checks and output summaries.
- **Plan through chat:** refine requirements, compare workflow drafts, select models, attach local files, and include project context or run errors. Conversations support history, archiving, cancellation, and background generation while the assistant is closed.
- **Use research tools:** search PubMed metadata; read DOCX, text-based PDFs, and text files; run Python/R scripts; check required fields; and invoke stdio MCP tools.
- **Configure your research agent:** set global or project-specific rules, Skills, and default models; link local Codex Skills and MCP configuration through symlinks.
- **Review and deliver:** compare revisions in a structured approval view, preview and download artifacts, export Word/PDF/text documents, package results as ZIP, and freeze reviewed outputs with a manifest.

The application interface and detailed operational guides are currently primarily in Chinese. This README is the English entry point.

## What you need

For the core application:

- **Java 21**, with `JAVA_HOME` set to the JDK directory.
- **Maven**; the repository does not include a Maven Wrapper.
- **Node.js 22+ and npm**.
- **MySQL and Redis**, running and reachable from the backend. Redis is used for login refresh tokens.
- **A model endpoint and API key** for the assistant and LLM nodes. Model discovery uses an OpenAI-compatible model-list endpoint.

Add dependencies for the nodes you plan to use:

- **Python:** an interpreter and the packages used by your scripts. The bundled analysis example uses `pandas`.
- **Documents:** a Python interpreter with `python-docx` for Word, `pypdf` for PDF reading, and `reportlab` for PDF export. Scanned PDFs need OCR before text extraction.
- **R:** `Rscript` and the packages used by your analysis; the bundled example uses `jsonlite`.
- **PostgreSQL:** your own databases, read-only credentials, and [the PostgreSQL Python dependencies](scripts/requirements-postgres.txt).
- **MCP / Codex integration:** the relevant MCP server executables, or an existing local Codex configuration and Skills directory.

MySQL stores model and tool configuration; project definitions, assistant sessions, run records, and artifacts are stored in the local research data directory. PostgreSQL is an optional research data source, separate from SciNode's MySQL application database.

## Configure a fresh installation

These steps are for a **new source checkout**. For an already configured macOS workspace, use [the existing-deployment commands](#start-an-already-configured-macos-workspace).

### 1. Get the code and prepare private configuration

```sh
git clone https://github.com/jialeyang0104/SciNode.git
cd SciNode
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Edit `backend/.env` before starting the backend:

- Set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USERNAME`, and `MYSQL_PASSWORD` for your MySQL service. Keep `MYSQL_DATABASE=scinode` when using the supplied initialization SQL.
- Set `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` for your Redis service.
- Set your own `APP_AUTH_DEFAULT_USERNAME` and `APP_AUTH_DEFAULT_PASSWORD`. These values provide the login account directly.
- Replace `JWT_SECRET` with a random value of at least 32 characters; `openssl rand -hex 32` can generate one.
- Add `server.address=127.0.0.1` to keep the backend bound to the local machine.

The template defaults are backend `8084`, MySQL `3306`, and Redis `6379`. The author's configured macOS deployment uses MySQL `3307` and Redis `6380`; choose the ports of your own services.

The backend reads `.env` as a Java properties file. In `frontend/.env.local`, keep `VITE_API_BASE_URL=/api`; set `VITE_API_PROXY_TARGET` if your backend is not at `http://localhost:8084`.

### 2. Initialize a new application database

Start MySQL and Redis first. Import the schema using a MySQL administrator account; adjust the host, port, and username for your installation:

```sh
mysql -h 127.0.0.1 -P 3306 -u root -p < backend/src/main/resources/schema.sql
```

The SQL creates and selects the `scinode` database. Configure the backend's database user with access to it. This is a first-install step; an existing workspace should retain its database and research files. Startup migrations handle selected upgrades after the initial schema is present.

### 3. Install and start the application

Install frontend dependencies from the repository root:

```sh
cd frontend
npm ci
```

Use two terminals. In the first, from the repository root:

```sh
cd backend
mvn spring-boot:run
```

In the second, from the repository root:

```sh
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open [the research workspace](http://127.0.0.1:5173/research) and sign in with the account configured above. Stop each development process with `Ctrl+C` in its terminal.

### 4. Connect a model

1. Open **Model settings** (`模型设置` / `模型管理`) and add a connection.
2. Enter a descriptive endpoint name (`端口名称`), provider, API base URL, and API key.
3. Refresh the actual model list and select a default model. Model choices are identified by **endpoint name + specific model**.
4. Save and select **Test connection** (`测试连接`) to check an actual model call.
5. Select the default service and model in **Global settings**, or override them in **Project settings**. An explicit node-level choice takes priority.

For assistant reasoning levels, start with **Default**. Low, medium, and high send `reasoning_effort` to the selected endpoint and require endpoint support.

### 5. Configure local tools and research rules

In `backend/.env`, set the runtime paths needed by your nodes:

```properties
SCINODE_DATA_DIR=/absolute/path/to/research-data
SCINODE_PYTHON=/absolute/path/to/python3
SCINODE_DOCUMENT_PYTHON=/absolute/path/to/python3
SCINODE_RSCRIPT=/absolute/path/to/Rscript
```

Choose a writable data directory. Install the document packages in the interpreter selected by `SCINODE_DOCUMENT_PYTHON`, and your analysis packages in the interpreter selected by `SCINODE_PYTHON`. Restart the backend after changing runtime configuration. The [environment template](backend/.env.example) is the configuration reference.

In **Global settings** or **Project settings**:

- Add rules for evidence handling, missing information, and decisions requiring human approval. Project settings can inherit and extend global settings.
- Enable the evidence, reproducibility, or writing Skills, or add custom guides.
- For MCP, add a **stdio** command, arguments, and private environment variables; test the tool list, authorize the connection, then select it in a node.
- For existing Codex resources, use **Codex sources → Link Codex sources**. The default sources are `~/.codex/skills` and `~/.codex/config.toml`; SciNode reads them through local symlinks.

## Run your first workflow

Start with a small, inspectable workflow:

**Task input → Research task → Human review → Document export → Result package**

1. Create a blank project, or ask the assistant to draft one. For example: “Plan a literature-review workflow: search PubMed, extract an evidence table, pause for my approval, and export a Word report. Ask me to clarify the scope first.”
2. Inspect the proposed nodes and connections before applying the draft. Save to create a project version.
3. Configure each node using **Task settings → Input material → Output and checks**. Use presets where useful, select the actual model, and map upstream outputs into downstream inputs.
4. Review the scripts, tool calls, and execution scope. Confirm which materials may be sent to the model, then start the run.
5. Follow the highlighted nodes and output summaries. At a human-review node, inspect the material and approve or return it for revision.
6. Preview and download the results. Freeze reviewed artifacts, or create a rerun branch from the step that needs to change.

Scripts and MCP tools run with the local account's permissions. Review their commands and access before execution. Prompt text, referenced material, parsed chat attachments, and selected tool results are sent to the model when used in a request; keep sensitive research records in local processing steps and inspect model-bound context before sending.

## Example: request-driven PostgreSQL extraction

The repository includes [read-only extraction code](scripts/postgres_workflow.py), [dependencies](scripts/requirements-postgres.txt), and [tests](scripts/test_postgres_workflow.py). The configured local project connects these stages:

**Requirements → Actual schema → Model-generated SQL plan → Human approval → Read-only extraction and preview → Download package**

- Supported ports are `5432` and `5433`; default database names are `mimiciv` and `mimiciii`. Prepare your own databases and select the intended names in the requirements.
- Database inventory reads both ports. Authentication uses libpq configuration such as `.pgpass`, or private `PG5432_*` / `PG5433_*` settings.
- A run accepts 1–4 queries. The default cap is 5,000 rows per query, configurable up to 100,000; the UI previews the first 20 rows and marks truncation.
- Outputs include CSV, JSONL, SQL, parameter and execution records, and a ZIP package. JSONL preserves the distinction between null and an empty string.
- Queries use SQL validation, read-only transactions, and a 60-second statement timeout. Model planning receives requirements and schema information; extracted rows stay in the local workflow.

The saved demonstration project and its datasets belong to the local deployment. On a new installation, create the workflow and configure its data sources using the [detailed guide in Chinese](SciNode使用指南.md#双-postgresql-需求提取).

## Start an already configured macOS workspace

Double-click `启动SciNode.command`, `停止SciNode.command`, or `查看SciNode状态.command`, or run from the repository root:

```sh
python3 deploy/local/manage.py start
python3 deploy/local/manage.py status
python3 deploy/local/manage.py stop
```

These controls use previously generated private configuration, built frontend/backend artifacts, and macOS LaunchAgents. The deployment uses web `5173`, API `8084`, MySQL `3307`, and Redis `6380` on loopback addresses.

`deploy/local/bootstrap.py` targets the author's macOS/Homebrew paths and writes environment files. Use the source-setup instructions above for a new machine; use `manage.py` for daily operation of the existing deployment.

## Repository map

| Path | Purpose | Main inputs and outputs | Entry point |
|---|---|---|---|
| [frontend/](frontend/) | React, TypeScript, Vite, React Flow UI | Projects, assistant, node settings, run previews | `npm run dev` / `npm run build` |
| [backend/](backend/) | Java 21 / Spring Boot API and execution | Authentication, models, tools, projects, runs, artifacts | `mvn spring-boot:run` |
| [scripts/](scripts/) | Reusable PostgreSQL execution code and tests | Schema, reviewed queries, CSV/JSONL exports | Python workflow nodes |
| [deploy/local/](deploy/local/) | Existing macOS deployment controls | Private service configuration and LaunchAgents | `manage.py` |
| `backend/scinode-data/` | Default research data location, relative to a backend-directory launch | Projects, sessions, inputs, runs, artifacts | Created locally; excluded from Git |
| [SciNode使用指南.md](SciNode使用指南.md) | Detailed user guide, Chinese | Configuration, assistant, review, export, freezing | Read the relevant task section |
| [本地部署说明.md](本地部署说明.md) | Deployment guide, Chinese | Fresh setup and existing local service operation | Choose the matching deployment path |

`SCINODE_DATA_DIR` can override the default research data location. Project-specific external workspaces also need to be preserved during migration.

## Development and current scope

The current implementation includes the project canvas, conversational drafting, local tool execution, human approval, artifact export, run branching, and freezing. The configured local PostgreSQL example has recorded end-to-end model planning, manual approval, preview, and download checks; its private acceptance files and saved project are excluded from Git.

Build the frontend with `npm run build` in `frontend/`. Run backend checks with `mvn test package` in `backend/`; Spring-context tests need the configured MySQL/Redis services. PostgreSQL script tests can be run, after installing their dependencies, from the repository root:

```sh
python3 -m unittest discover -s scripts -p 'test_postgres_workflow.py'
```

Closing the assistant leaves its current generation running in the backend. A backend restart interrupts active assistant tasks and workflow runs; retain the recorded state, then retry the assistant request or create a new workflow run branch.

## Keep research data separate from source control

The repository tracks source, tests, dependency lists and lockfiles, configuration examples, documentation, the site icon, and deployment scripts.

[`.gitignore`](.gitignore) excludes private environment files, credentials, database storage and dumps, research projects and conversations, run artifacts, logs, dependencies, build output, and local development-tool data. Review new files before committing.

Back up **MySQL, the research data directory, and any external project workspaces** together. Keep original inputs, human decisions, historical runs, and frozen artifacts; use a new run for further work.

For upstream attribution, see [Third-party notices](THIRD_PARTY_NOTICES.md).
