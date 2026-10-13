# Seeco (EcoTrace)

Biodiversity-risk intelligence for Australian companies. Search by **barcode, brand name or ABN** and Seeco resolves the legal entity behind it, works out where it operates, overlays species and protected-land data, weighs news and report evidence, and returns an explainable **0–100 biodiversity risk score** with a confidence rating and a printable report.

Scores are decision-support signals built from public data and LLM-extracted evidence. They are not regulatory or legal determinations.

## What it does

| Stage | What happens |
|---|---|
| **Entity resolution** | A barcode (EAN/GTIN), brand name or ABN is resolved to a verified legal entity using OpenFoodFacts, IP Australia Trade Mark Search and the Australian Business Register (ABR), with ABN (ATO mod-89) and EAN checksum validation. |
| **Spatial analysis** | A company location is inferred from its ABN record or from locations extracted from reports and news. Species records within a default 10 km radius come from the Atlas of Living Australia and are enriched with IUCN Red List threat categories. Overlaps with CAPAD protected areas, Key Biodiversity Areas and IBRA bioregions are queried in PostGIS. |
| **Evidence extraction** | News from several providers (SerpAPI, NewsAPI, Guardian, NYT, Webz, NewsData.io, FreeNewsAPI, Mediastack) and uploaded company reports are filtered for relevance and source quality. An LLM (OpenRouter or NVIDIA NIM) then extracts structured biodiversity evidence with a location, evidence type and confidence. |
| **Scoring** | A versioned, backend-owned score (`biodiversity-risk-v1.3-evidence-land-species`) combines species sensitivity (30%), land signals (35%), news and regulatory pressure (25%) and data gaps (10%). Bands: Low below 45, Medium from 45, High from 70, Critical from 85. |
| **Outputs** | Persisted HTML reports (viewable or emailed), company watchlists, a spatial analysis map and email magic-link sign-in. |

## Architecture

```
React + TypeScript (Vite)  ──/api──▶  FastAPI  ──▶  PostgreSQL + PostGIS
frontend/                             backend_clean/app
                                          │
     ABR · IP Australia · OpenFoodFacts · ALA · IUCN · news APIs · LLM provider
```

```
backend_clean/
  app/
    main.py       FastAPI app: search, analysis jobs, spatial, reports, watchlist, auth
    pipelines/    barcode, brand and ABN resolution; the evidence-extraction pipeline
    providers/    ALA + IUCN species layer and the PostGIS spatial loader
    services/     scoring, nature-score engine, company analysis, report rendering
    db/           schema, writers and the IUCN cache
    cache/        analysis cache
  migrations/     SQL for a fresh database
  scripts/        loaders for the CAPAD, KBA and IBRA spatial datasets
  tests/          pytest suite
frontend/         React 18 + Vite + Tailwind app and the Node server used on Azure
config/           analysis configuration
docs/             security plan report
```

**Stack:** Python 3.12 · FastAPI · PostgreSQL/PostGIS · React 18 · TypeScript · Vite · Tailwind · Azure App Service · GitHub Actions

## Run locally

Needs Python 3.12, Node 22 and PostgreSQL with PostGIS.

```bash
# Backend (from the repo root)
pip install -r backend_clean/requirements.txt
psql -d <your_database> -f backend_clean/migrations/20260520_full_schema_all_tables.sql
cp backend_clean/env.example backend_clean/.env    # add database settings and the API keys you have
uvicorn backend_clean.app.main:app --reload        # http://127.0.0.1:8000

# Frontend
cd frontend && npm ci && npm run dev               # http://localhost:5173, proxies /api to port 8000
```

The CAPAD, KBA and IBRA datasets are not committed (`datasets/` is gitignored). Download them and load them with the scripts in `backend_clean/scripts/`; each script's header shows the expected path. The IUCN Red List API token is read from `IUCN_TOKEN`.

## Tests

```bash
python -m pytest backend_clean/tests -q    # run from the repo root; needs no database or API keys
```

## Deployment

GitHub Actions deploys `backend_clean` and `frontend` to two Azure App Service instances backed by Azure Database for PostgreSQL. The backend workflow compiles the code and runs the tests before every deploy. See [AZURE_DEPLOYMENT.md](AZURE_DEPLOYMENT.md).

## Security

See [docs/security-plan-report.md](docs/security-plan-report.md) for the security review and its open items.
