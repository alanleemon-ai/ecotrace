-- Migration: Post-spatial-dataset application tables
-- Date: 2026-05-20
--
-- Use this after the core Seeco tables already exist and after the
-- CAPAD/KBA/IBRA dataset tables have already been migrated/imported.
--
-- This migration intentionally DOES NOT create:
--   - capad_protected_areas
--   - kba_sites
--   - ibra_regions
--
-- It creates the remaining app/runtime tables added for:
--   - email verification and auth sessions
--   - inferred locations and reports
--   - versioned scoring and persisted spatial analysis
--   - persisted land-signal results and cached map overlays
--   - watchlists
--   - news analysis cache and async company analysis jobs
--   - IUCN Red List cache

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_source_enum') THEN
        CREATE TYPE location_source_enum AS ENUM ('abn', 'news', 'report');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_confidence_enum') THEN
        CREATE TYPE location_confidence_enum AS ENUM ('high', 'medium', 'low');
    END IF;
END
$$;


-- ------------------------------------------------------------
-- Search query
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_query (
    query_id            UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID                    REFERENCES "user"(user_id) ON DELETE CASCADE,
    input_type          input_type_enum         NOT NULL,
    input_value         VARCHAR(500)            NOT NULL,
    resolution_status   resolution_status_enum  NOT NULL DEFAULT 'pending',
    resolved_company_id UUID                    REFERENCES company(company_id) ON DELETE SET NULL,
    resolved_brand_id   UUID                    REFERENCES brand(brand_id)     ON DELETE SET NULL,
    resolved_product_id UUID                    REFERENCES product(product_id) ON DELETE SET NULL,
    submitted_at        TIMESTAMP               NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_query_user_id
    ON search_query(user_id);

CREATE INDEX IF NOT EXISTS idx_search_query_input
    ON search_query(input_type, input_value);


-- ------------------------------------------------------------
-- Email verification + auth session
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification (
    verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES "user"(user_id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    token_hash      CHAR(64) NOT NULL UNIQUE,
    return_to       TEXT NOT NULL DEFAULT '/app/search',
    requested_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMP NOT NULL,
    verified_at     TIMESTAMP,
    delivery_method VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_email_verification_email
    ON email_verification(email, requested_at DESC);

CREATE TABLE IF NOT EXISTS auth_session (
    session_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    token_hash     CHAR(64) NOT NULL UNIQUE,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMP NOT NULL,
    last_used_at   TIMESTAMP,
    revoked_at     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user_id
    ON auth_session(user_id, expires_at DESC);


-- ------------------------------------------------------------
-- Inferred location
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inferred_location (
    location_id         UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID                        NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    source_type         location_source_enum        NOT NULL,
    abn_ref             CHAR(11)                    REFERENCES abn_record(abn) ON DELETE SET NULL,
    article_id          UUID                        REFERENCES news_article(article_id) ON DELETE SET NULL,
    report_id           UUID,
    label               VARCHAR(255),
    address_raw         TEXT,
    suburb              VARCHAR(100),
    state               CHAR(3),
    postcode            CHAR(4),
    country             CHAR(2)     NOT NULL DEFAULT 'AU',
    latitude            DOUBLE PRECISION,
    longitude           DOUBLE PRECISION,
    confidence          location_confidence_enum    NOT NULL DEFAULT 'medium',
    llm_model_version   VARCHAR(50),
    prov_agent          VARCHAR(255),
    extracted_at        TIMESTAMP                   NOT NULL DEFAULT NOW(),
    valid_from          TIMESTAMP                   NOT NULL DEFAULT NOW(),
    valid_to            TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_inferred_location_source'
    ) THEN
        ALTER TABLE inferred_location
        ADD CONSTRAINT uq_inferred_location_source
        UNIQUE NULLS NOT DISTINCT (company_id, source_type, abn_ref, article_id, latitude, longitude);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_inferred_loc_company_id
    ON inferred_location(company_id);

CREATE INDEX IF NOT EXISTS idx_inferred_loc_source_type
    ON inferred_location(source_type);

CREATE INDEX IF NOT EXISTS idx_inferred_loc_state_postcode
    ON inferred_location(state, postcode);

CREATE INDEX IF NOT EXISTS idx_inferred_loc_valid
    ON inferred_location(valid_from, valid_to);


-- ------------------------------------------------------------
-- Reports
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report (
    report_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id         UUID        NOT NULL REFERENCES search_query(query_id) ON DELETE CASCADE,
    recipient_email  VARCHAR(255),
    title            VARCHAR(500) NOT NULL,
    format           VARCHAR(20)  NOT NULL DEFAULT 'html',
    status           VARCHAR(30)  NOT NULL DEFAULT 'generated',
    html_content     TEXT         NOT NULL,
    metadata_json    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    generated_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
    sent_at          TIMESTAMP,
    delivery_method  VARCHAR(30)
);

CREATE INDEX IF NOT EXISTS idx_report_query_id
    ON report(query_id);

CREATE INDEX IF NOT EXISTS idx_report_generated_at
    ON report(generated_at);

CREATE INDEX IF NOT EXISTS idx_report_status
    ON report(status);


-- ------------------------------------------------------------
-- Versioned scoring + spatial result persistence
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS score_run (
    score_run_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id            UUID        NOT NULL REFERENCES search_query(query_id) ON DELETE CASCADE,
    score_version       VARCHAR(80) NOT NULL,
    final_score         NUMERIC(5,2) NOT NULL CHECK (final_score BETWEEN 0 AND 100),
    risk_band           VARCHAR(20) NOT NULL CHECK (risk_band IN ('Low', 'Medium', 'High', 'Critical')),
    confidence_score    NUMERIC(5,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
    component_json      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    input_snapshot_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
    generated_at        TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_run_query_id
    ON score_run(query_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_score_run_version
    ON score_run(score_version);

CREATE TABLE IF NOT EXISTS spatial_analysis_result (
    spatial_result_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id             UUID        NOT NULL REFERENCES search_query(query_id) ON DELETE CASCADE,
    status               VARCHAR(30) NOT NULL DEFAULT 'success',
    result_json          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    location_json        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    overlay_summary_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
    score_json           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    generated_at         TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spatial_analysis_result_query_id
    ON spatial_analysis_result(query_id, updated_at DESC);


-- ------------------------------------------------------------
-- Persisted land signals + cached map overlays
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS land_signal_result (
    land_signal_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id                   UUID        REFERENCES search_query(query_id) ON DELETE SET NULL,
    location_hash              CHAR(64)    NOT NULL,
    latitude                   DOUBLE PRECISION NOT NULL,
    longitude                  DOUBLE PRECISION NOT NULL,
    radius_km                  DOUBLE PRECISION NOT NULL,
    location_json              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    context_json               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    land_signal_counts_json    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    overlay_summary_json       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    land_score                 NUMERIC(5,2) NOT NULL CHECK (land_score BETWEEN 0 AND 100),
    protected_area_score       NUMERIC(5,2) NOT NULL CHECK (protected_area_score BETWEEN 0 AND 100),
    ecological_priority_score  NUMERIC(5,2) NOT NULL CHECK (ecological_priority_score BETWEEN 0 AND 100),
    generated_at               TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMP   NOT NULL DEFAULT NOW(),
    UNIQUE(location_hash)
);

CREATE INDEX IF NOT EXISTS idx_land_signal_result_query_location
    ON land_signal_result(query_id, location_hash, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_land_signal_result_location
    ON land_signal_result(location_hash, updated_at DESC);

CREATE TABLE IF NOT EXISTS nature_score_result (
    nature_score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id        UUID        NOT NULL REFERENCES search_query(query_id) ON DELETE CASCADE,
    score_version   VARCHAR(80) NOT NULL,
    status          VARCHAR(30) NOT NULL DEFAULT 'success',
    score_status    VARCHAR(30) NOT NULL DEFAULT 'partial_spatial',
    location_hash   CHAR(64)    NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    radius_km       DOUBLE PRECISION NOT NULL,
    location_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    species_json    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    land_json       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    evidence_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    score_json      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    result_json     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    generated_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
    UNIQUE(query_id, score_version, location_hash)
);

CREATE INDEX IF NOT EXISTS idx_nature_score_result_query_latest
    ON nature_score_result(query_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS spatial_overlay_cache (
    overlay_cache_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_hash    CHAR(64)    NOT NULL,
    latitude         DOUBLE PRECISION NOT NULL,
    longitude        DOUBLE PRECISION NOT NULL,
    radius_km        DOUBLE PRECISION NOT NULL,
    capad_limit      INTEGER     NOT NULL,
    kba_limit        INTEGER     NOT NULL,
    ibra_limit       INTEGER     NOT NULL,
    tolerance        DOUBLE PRECISION NOT NULL,
    response_json    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    generated_at     TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP   NOT NULL DEFAULT NOW(),
    UNIQUE(location_hash, capad_limit, kba_limit, ibra_limit)
);

CREATE INDEX IF NOT EXISTS idx_spatial_overlay_cache_location
    ON spatial_overlay_cache(location_hash, updated_at DESC);


-- ------------------------------------------------------------
-- Company watchlist
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_watchlist (
    watchlist_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    company_id          UUID        REFERENCES company(company_id) ON DELETE SET NULL,
    query_id            UUID        REFERENCES search_query(query_id) ON DELETE SET NULL,
    company_name        VARCHAR(255) NOT NULL,
    abn                 CHAR(11),
    industry            VARCHAR(255),
    region              VARCHAR(255),
    risk_score          INTEGER,
    risk_level          VARCHAR(30),
    alerts_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    notes               TEXT,
    metadata_json       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_watchlist_user_company
    ON company_watchlist (
        user_id,
        COALESCE(company_id::text, ''),
        COALESCE(abn, ''),
        lower(company_name)
    );

CREATE INDEX IF NOT EXISTS idx_company_watchlist_user_id
    ON company_watchlist(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_watchlist_company_id
    ON company_watchlist(company_id);


-- ------------------------------------------------------------
-- News analysis cache + async company analysis jobs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS news_analysis_cache (
    cache_key           CHAR(64)    PRIMARY KEY,
    company_id          UUID        REFERENCES company(company_id) ON DELETE SET NULL,
    normalized_name     VARCHAR(255) NOT NULL,
    params_json         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    candidates_json     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    evidence_json       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    model_fingerprint   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMP   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_analysis_cache_company_id
    ON news_analysis_cache(company_id);

CREATE INDEX IF NOT EXISTS idx_news_analysis_cache_expires_at
    ON news_analysis_cache(expires_at);

CREATE TABLE IF NOT EXISTS company_analysis_job (
    job_id           UUID        PRIMARY KEY,
    status           VARCHAR(30) NOT NULL,
    progress         INTEGER     NOT NULL DEFAULT 0,
    current_step     TEXT,
    company_or_abn   TEXT        NOT NULL,
    result_json      JSONB,
    error            TEXT,
    query_id         UUID        REFERENCES search_query(query_id) ON DELETE SET NULL,
    llm_current      INTEGER,
    llm_total        INTEGER,
    current_article  TEXT,
    created_at       TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP   NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMP   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_company_analysis_job_expires_at
    ON company_analysis_job(expires_at);

CREATE INDEX IF NOT EXISTS idx_company_analysis_job_query_id
    ON company_analysis_job(query_id);


-- ------------------------------------------------------------
-- IUCN durable cache
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iucn_redlist_cache (
    scientific_name    TEXT        PRIMARY KEY,
    category_code      VARCHAR(10),
    category_name      VARCHAR(80),
    iucn_url           TEXT,
    source             VARCHAR(120) NOT NULL DEFAULT 'IUCN Red List v4 countries/AU',
    raw_json           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    imported_at        TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iucn_redlist_cache_category
    ON iucn_redlist_cache(category_code);

CREATE INDEX IF NOT EXISTS idx_iucn_redlist_cache_imported_at
    ON iucn_redlist_cache(imported_at DESC);

COMMIT;
