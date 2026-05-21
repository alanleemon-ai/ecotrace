-- Migration: Full Seeco schema, all tables
-- Date: 2026-05-20
--
-- Use this for a new database or an environment where you want every Seeco
-- application table plus the spatial dataset tables created from one file.
--
-- Includes:
--   - core search/company/product graph tables
--   - auth/email/session tables
--   - reports, scoring, spatial result persistence, watchlist, caches
--   - IUCN cache
--   - IBRA, KBA, and CAPAD spatial dataset tables
--
-- Notes:
--   - Requires pgcrypto for gen_random_uuid().
--   - Requires PostGIS for geometry(MultiPolygon, 4326).
--   - CREATE TABLE IF NOT EXISTS does not backfill missing columns on an
--     already-partial schema. Use this as a full bootstrap migration.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_type_enum') THEN
        CREATE TYPE user_type_enum AS ENUM ('consumer', 'investor', 'esg_platform');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'input_type_enum') THEN
        CREATE TYPE input_type_enum AS ENUM ('company_name', 'brand_name', 'barcode');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resolution_status_enum') THEN
        CREATE TYPE resolution_status_enum AS ENUM ('pending', 'resolved', 'failed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entity_type_enum') THEN
        CREATE TYPE entity_type_enum AS ENUM ('PTY LTD', 'LTD', 'TRUST', 'PARTNERSHIP', 'SOLE TRADER', 'OTHER');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'company_status_enum') THEN
        CREATE TYPE company_status_enum AS ENUM ('registered', 'deregistered', 'suspended');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trademark_status_enum') THEN
        CREATE TYPE trademark_status_enum AS ENUM ('registered', 'pending', 'lapsed', 'removed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_source_enum') THEN
        CREATE TYPE data_source_enum AS ENUM ('open_food_facts', 'gs1');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'node_type_enum') THEN
        CREATE TYPE node_type_enum AS ENUM ('company', 'facility', 'location', 'species');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sentiment_enum') THEN
        CREATE TYPE sentiment_enum AS ENUM ('positive', 'neutral', 'negative');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_source_enum') THEN
        CREATE TYPE location_source_enum AS ENUM ('abn', 'news', 'report');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_confidence_enum') THEN
        CREATE TYPE location_confidence_enum AS ENUM ('high', 'medium', 'low');
    END IF;
END
$$;


-- ------------------------------------------------------------
-- Core identity/search tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user" (
    user_id     UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type   user_type_enum  NOT NULL,
    email       VARCHAR(255)    NOT NULL UNIQUE,
    created_at  TIMESTAMP       NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS abn_record (
    abn             CHAR(11)            PRIMARY KEY,
    legal_name      VARCHAR(255)        NOT NULL,
    entity_type     entity_type_enum    NOT NULL,
    gst_registered  BOOLEAN             NOT NULL DEFAULT FALSE,
    state           CHAR(3),
    postcode        CHAR(4),
    last_updated    TIMESTAMP           NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company (
    company_id      UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    abn             CHAR(11)            NOT NULL UNIQUE REFERENCES abn_record(abn),
    acn             CHAR(9)             UNIQUE,
    legal_name      VARCHAR(255)        NOT NULL,
    entity_type     entity_type_enum    NOT NULL,
    company_status  company_status_enum NOT NULL DEFAULT 'registered',
    anzsic_code     VARCHAR(10)
);

CREATE INDEX IF NOT EXISTS idx_company_abn
    ON company(abn);

CREATE INDEX IF NOT EXISTS idx_company_legal_name
    ON company(legal_name);

CREATE TABLE IF NOT EXISTS trademark (
    trademark_id        UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    trademark_number    VARCHAR(50)             NOT NULL UNIQUE,
    trademark_name      VARCHAR(255)            NOT NULL,
    owner_legal_name    VARCHAR(255)            NOT NULL,
    class_code          VARCHAR(10),
    status              trademark_status_enum   NOT NULL DEFAULT 'registered',
    registration_date   DATE
);

CREATE TABLE IF NOT EXISTS brand (
    brand_id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_name      VARCHAR(255) NOT NULL,
    company_id      UUID         NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    trademark_id    UUID         REFERENCES trademark(trademark_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_brand_company_id
    ON brand(company_id);

CREATE INDEX IF NOT EXISTS idx_brand_trademark_id
    ON brand(trademark_id);

CREATE TABLE IF NOT EXISTS product (
    product_id          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    barcode             VARCHAR(20)         NOT NULL UNIQUE,
    product_name        VARCHAR(255)        NOT NULL,
    brand_id            UUID                NOT NULL REFERENCES brand(brand_id) ON DELETE RESTRICT,
    manufacturer_name   VARCHAR(255),
    data_source         data_source_enum    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_brand_id
    ON product(brand_id);

CREATE INDEX IF NOT EXISTS idx_product_barcode
    ON product(barcode);

CREATE TABLE IF NOT EXISTS search_query (
    query_id            UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID                    REFERENCES "user"(user_id) ON DELETE CASCADE,
    input_type          input_type_enum         NOT NULL,
    input_value         VARCHAR(500)            NOT NULL,
    resolution_status   resolution_status_enum  NOT NULL DEFAULT 'pending',
    resolved_company_id UUID                    REFERENCES company(company_id) ON DELETE SET NULL,
    resolved_brand_id   UUID                    REFERENCES brand(brand_id) ON DELETE SET NULL,
    resolved_product_id UUID                    REFERENCES product(product_id) ON DELETE SET NULL,
    submitted_at        TIMESTAMP               NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_query_user_id
    ON search_query(user_id);

CREATE INDEX IF NOT EXISTS idx_search_query_input
    ON search_query(input_type, input_value);


-- ------------------------------------------------------------
-- Graph, news, risk, and inferred location
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graph_node (
    node_id     UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID            NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    node_type   node_type_enum  NOT NULL,
    label       VARCHAR(255)    NOT NULL,
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    valid_from  TIMESTAMP       NOT NULL DEFAULT NOW(),
    valid_to    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_graph_node_company_id
    ON graph_node(company_id);

CREATE INDEX IF NOT EXISTS idx_graph_node_valid
    ON graph_node(valid_from, valid_to);

CREATE TABLE IF NOT EXISTS news_article (
    article_id      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID            NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    headline        VARCHAR(500)    NOT NULL,
    source_url      VARCHAR(1000)   NOT NULL UNIQUE,
    publisher       VARCHAR(255),
    sentiment       sentiment_enum  NOT NULL DEFAULT 'neutral',
    published_at    TIMESTAMP,
    ingested_at     TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_company_id
    ON news_article(company_id);

CREATE INDEX IF NOT EXISTS idx_news_published_at
    ON news_article(published_at);

CREATE INDEX IF NOT EXISTS idx_news_sentiment
    ON news_article(sentiment);

CREATE TABLE IF NOT EXISTS risk_event (
    event_id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id             UUID            NOT NULL REFERENCES graph_node(node_id) ON DELETE CASCADE,
    source_type         VARCHAR(20)     NOT NULL DEFAULT 'news' CHECK (source_type = 'news'),
    source_id           UUID            NOT NULL REFERENCES news_article(article_id) ON DELETE CASCADE,
    risk_type           VARCHAR(100)    NOT NULL,
    description         TEXT,
    confidence_score    FLOAT           CHECK (confidence_score BETWEEN 0 AND 1),
    llm_model_version   VARCHAR(50),
    prov_agent          VARCHAR(255),
    extracted_at        TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_event_node_id
    ON risk_event(node_id);

CREATE INDEX IF NOT EXISTS idx_risk_event_source_id
    ON risk_event(source_id);

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
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_inferred_location_source'
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
-- Reports, scoring, spatial persistence, watchlist, caches
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report (
    report_id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id         UUID         NOT NULL REFERENCES search_query(query_id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS score_run (
    score_run_id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id            UUID         NOT NULL REFERENCES search_query(query_id) ON DELETE CASCADE,
    score_version       VARCHAR(80)  NOT NULL,
    final_score         NUMERIC(5,2) NOT NULL CHECK (final_score BETWEEN 0 AND 100),
    risk_band           VARCHAR(20)  NOT NULL CHECK (risk_band IN ('Low', 'Medium', 'High', 'Critical')),
    confidence_score    NUMERIC(5,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
    component_json      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    input_snapshot_json JSONB        NOT NULL DEFAULT '{}'::jsonb,
    generated_at        TIMESTAMP    NOT NULL DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS land_signal_result (
    land_signal_id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id                   UUID         REFERENCES search_query(query_id) ON DELETE SET NULL,
    location_hash              CHAR(64)     NOT NULL,
    latitude                   DOUBLE PRECISION NOT NULL,
    longitude                  DOUBLE PRECISION NOT NULL,
    radius_km                  DOUBLE PRECISION NOT NULL,
    location_json              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    context_json               JSONB        NOT NULL DEFAULT '{}'::jsonb,
    land_signal_counts_json    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    overlay_summary_json       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    land_score                 NUMERIC(5,2) NOT NULL CHECK (land_score BETWEEN 0 AND 100),
    protected_area_score       NUMERIC(5,2) NOT NULL CHECK (protected_area_score BETWEEN 0 AND 100),
    ecological_priority_score  NUMERIC(5,2) NOT NULL CHECK (ecological_priority_score BETWEEN 0 AND 100),
    generated_at               TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMP    NOT NULL DEFAULT NOW(),
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

CREATE TABLE IF NOT EXISTS company_watchlist (
    watchlist_id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID         NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    company_id          UUID         REFERENCES company(company_id) ON DELETE SET NULL,
    query_id            UUID         REFERENCES search_query(query_id) ON DELETE SET NULL,
    company_name        VARCHAR(255) NOT NULL,
    abn                 CHAR(11),
    industry            VARCHAR(255),
    region              VARCHAR(255),
    risk_score          INTEGER,
    risk_level          VARCHAR(30),
    alerts_enabled      BOOLEAN      NOT NULL DEFAULT TRUE,
    notes               TEXT,
    metadata_json       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP    NOT NULL DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS news_analysis_cache (
    cache_key           CHAR(64)     PRIMARY KEY,
    company_id          UUID         REFERENCES company(company_id) ON DELETE SET NULL,
    normalized_name     VARCHAR(255) NOT NULL,
    params_json         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    candidates_json     JSONB        NOT NULL DEFAULT '[]'::jsonb,
    evidence_json       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    model_fingerprint   JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMP    NOT NULL
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

CREATE TABLE IF NOT EXISTS iucn_redlist_cache (
    scientific_name    TEXT         PRIMARY KEY,
    category_code      VARCHAR(10),
    category_name      VARCHAR(80),
    iucn_url           TEXT,
    source             VARCHAR(120) NOT NULL DEFAULT 'IUCN Red List v4 countries/AU',
    raw_json           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    imported_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iucn_redlist_cache_category
    ON iucn_redlist_cache(category_code);

CREATE INDEX IF NOT EXISTS idx_iucn_redlist_cache_imported_at
    ON iucn_redlist_cache(imported_at DESC);


-- ------------------------------------------------------------
-- Spatial dataset tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ibra_regions (
    ibra_region_id  BIGSERIAL PRIMARY KEY,
    object_id       INTEGER,
    region_code     VARCHAR(20) NOT NULL,
    region_name     TEXT        NOT NULL,
    region_number   INTEGER,
    state_code      VARCHAR(10),
    shape_area      DOUBLE PRECISION,
    shape_length    DOUBLE PRECISION,
    area_km2        DOUBLE PRECISION,
    source_dataset  VARCHAR(120) NOT NULL DEFAULT 'IBRARegion_Aust70',
    source_path     TEXT,
    raw_json        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    geometry        geometry(MultiPolygon, 4326) NOT NULL,
    imported_at     TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ibra_regions_source_object
    ON ibra_regions(source_dataset, object_id)
    WHERE object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ibra_regions_region_code
    ON ibra_regions(region_code);

CREATE INDEX IF NOT EXISTS idx_ibra_regions_state_code
    ON ibra_regions(state_code);

CREATE INDEX IF NOT EXISTS idx_ibra_regions_geometry
    ON ibra_regions USING GIST (geometry);

CREATE TABLE IF NOT EXISTS kba_sites (
    kba_site_id        BIGSERIAL PRIMARY KEY,
    sitrec_id          INTEGER,
    region             TEXT,
    country            TEXT,
    iso3               CHAR(3),
    national_name      TEXT,
    international_name TEXT,
    site_lat           DOUBLE PRECISION,
    site_lon           DOUBLE PRECISION,
    site_area_km2      DOUBLE PRECISION,
    kba_status         VARCHAR(80),
    kba_class          VARCHAR(120),
    iba_status         VARCHAR(80),
    legacy_kba         VARCHAR(80),
    aze_status         VARCHAR(80),
    last_update        VARCHAR(80),
    source             TEXT,
    shape_length       DOUBLE PRECISION,
    shape_area         DOUBLE PRECISION,
    source_dataset     VARCHAR(120) NOT NULL DEFAULT 'KBAsGlobal_2026_March_01_POL',
    source_path        TEXT,
    raw_json           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    geometry           geometry(MultiPolygon, 4326) NOT NULL,
    imported_at        TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kba_sites_source_sitrec
    ON kba_sites(source_dataset, sitrec_id)
    WHERE sitrec_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kba_sites_iso3
    ON kba_sites(iso3);

CREATE INDEX IF NOT EXISTS idx_kba_sites_country
    ON kba_sites(country);

CREATE INDEX IF NOT EXISTS idx_kba_sites_kba_status
    ON kba_sites(kba_status);

CREATE INDEX IF NOT EXISTS idx_kba_sites_geometry
    ON kba_sites USING GIST (geometry);

CREATE TABLE IF NOT EXISTS capad_protected_areas (
    capad_area_id     BIGSERIAL PRIMARY KEY,
    object_id         INTEGER,
    pa_id             VARCHAR(80),
    pa_pid            VARCHAR(80),
    name              TEXT,
    pa_type           TEXT,
    type_abbr         VARCHAR(40),
    iucn_category     VARCHAR(20),
    nrs_pa            VARCHAR(20),
    nrs_mpa           VARCHAR(20),
    gaz_area_ha       DOUBLE PRECISION,
    gis_area_ha       DOUBLE PRECISION,
    gaz_date          DATE,
    latest_gaz_date   DATE,
    state_code        VARCHAR(20),
    authority         TEXT,
    datasource        TEXT,
    governance        TEXT,
    comments          TEXT,
    environment       VARCHAR(40),
    overlap           VARCHAR(40),
    mgt_plan_status   VARCHAR(80),
    res_number        TEXT,
    zone_type         TEXT,
    epbc              VARCHAR(80),
    longitude         DOUBLE PRECISION,
    latitude          DOUBLE PRECISION,
    pa_system         VARCHAR(80),
    shape_area        DOUBLE PRECISION,
    shape_length      DOUBLE PRECISION,
    is_indigenous_pa  BOOLEAN     NOT NULL DEFAULT FALSE,
    source_dataset    VARCHAR(120) NOT NULL DEFAULT 'CAPAD_2024_Terrestrial',
    source_path       TEXT,
    raw_json          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    geometry          geometry(MultiPolygon, 4326) NOT NULL,
    imported_at       TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capad_protected_areas_source_object
    ON capad_protected_areas(source_dataset, object_id)
    WHERE object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_capad_protected_areas_pa_id
    ON capad_protected_areas(pa_id);

CREATE INDEX IF NOT EXISTS idx_capad_protected_areas_state_code
    ON capad_protected_areas(state_code);

CREATE INDEX IF NOT EXISTS idx_capad_protected_areas_iucn
    ON capad_protected_areas(iucn_category);

CREATE INDEX IF NOT EXISTS idx_capad_protected_areas_type_abbr
    ON capad_protected_areas(type_abbr);

CREATE INDEX IF NOT EXISTS idx_capad_protected_areas_geometry
    ON capad_protected_areas USING GIST (geometry);

COMMIT;
