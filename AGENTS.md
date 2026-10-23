# SciNode development

SciNode is a local personal research workflow workspace.

## Commands

- Frontend: `cd frontend && npm run build`; use the project ESLint configuration for changed files.
- Backend: Java 21, Maven `test package`; package namespace is `com.scinode`.
- Local services: `python3 deploy/local/manage.py start|stop|status`.

## Structure

- `frontend/src/pages/ResearchPage.tsx`: project workspace and workflow canvas.
- `frontend/src/research/`: project dashboard, catalogs and research settings.
- `backend/src/main/java/com/scinode/research/`: projects, version records, research execution and artifacts.
- `engine/dag/` and `engine/model/`: workflow validation and dependency parsing.
- Controllers and services cover authentication, model configuration, MCP, knowledge and Skills.

## Data integrity

Preserve project records, original inputs, frozen manifests and file hashes. Directory relocation resolves historical paths at runtime; historical records retain their source paths. Keep secrets and local service data in ignored private files. Expose execution errors explicitly. Preserve existing REST interfaces used by the SciNode frontend.
