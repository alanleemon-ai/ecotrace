from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Optional

from psycopg2.extras import Json, RealDictCursor

from ..db.connection import get_conn
from .scoring_service import (
    SCORE_VERSION,
    combined_biodiversity_score,
    evidence_input_signature,
    evidence_records_from_analysis,
    land_signal_score,
)


def ensure_nature_score_tables(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS land_signal_result (
            land_signal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            query_id UUID REFERENCES search_query(query_id) ON DELETE SET NULL,
            location_hash CHAR(64) NOT NULL,
            latitude DOUBLE PRECISION NOT NULL,
            longitude DOUBLE PRECISION NOT NULL,
            radius_km DOUBLE PRECISION NOT NULL,
            location_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            land_signal_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            overlay_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            land_score NUMERIC(5,2) NOT NULL CHECK (land_score BETWEEN 0 AND 100),
            protected_area_score NUMERIC(5,2) NOT NULL CHECK (protected_area_score BETWEEN 0 AND 100),
            ecological_priority_score NUMERIC(5,2) NOT NULL CHECK (ecological_priority_score BETWEEN 0 AND 100),
            generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE(location_hash)
        );
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_land_signal_result_location
        ON land_signal_result(location_hash, updated_at DESC);
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS nature_score_result (
            nature_score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            query_id UUID NOT NULL REFERENCES search_query(query_id) ON DELETE CASCADE,
            score_version VARCHAR(80) NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'success',
            score_status VARCHAR(30) NOT NULL DEFAULT 'partial_spatial',
            location_hash CHAR(64) NOT NULL,
            latitude DOUBLE PRECISION NOT NULL,
            longitude DOUBLE PRECISION NOT NULL,
            radius_km DOUBLE PRECISION NOT NULL,
            location_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            species_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            land_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            score_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE(query_id, score_version, location_hash)
        );
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_nature_score_result_query_latest
        ON nature_score_result(query_id, updated_at DESC);
        """
    )


def spatial_location_hash(lat: float, lon: float, radius_km: float) -> str:
    return hashlib.sha256(f"{lat:.5f}:{lon:.5f}:{radius_km:.2f}".encode("utf-8")).hexdigest()


def canonical_location(spatial_payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    location = spatial_payload.get("inferred_location") or spatial_payload.get("location")
    if not isinstance(location, dict):
        return None
    try:
        lat = float(location["lat"])
        lon = float(location["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    radius_km = float(location.get("radius_km") or 10.0)
    return {**location, "lat": lat, "lon": lon, "radius_km": radius_km}


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def land_signal_counts_from_context(context: dict[str, Any]) -> dict[str, int]:
    return {
        "protected_area_count": _as_int(context.get("protected_area_count")),
        "protected_area_direct_count": _as_int(context.get("protected_area_direct_count")),
        "bioregion_count": _as_int(context.get("ibra_count")),
        "kba_count": _as_int(context.get("kba_count")),
        "kba_direct_count": _as_int(context.get("kba_direct_count")),
    }


def nature_signal_counts_from_payload(spatial_payload: dict[str, Any], context: dict[str, Any]) -> dict[str, int]:
    occurrences = spatial_payload.get("threatened_occurrences")
    return {
        "threatened_species_count": _as_int(spatial_payload.get("threatened_species_count")),
        "threatened_occurrence_count": len(occurrences) if isinstance(occurrences, list) else 0,
        "protected_area_count": _as_int(context.get("protected_area_count")),
        "bioregion_count": _as_int(context.get("ibra_count")),
        "kba_count": _as_int(context.get("kba_count")),
        "protected_area_direct_count": _as_int(context.get("protected_area_direct_count")),
        "kba_direct_count": _as_int(context.get("kba_direct_count")),
    }


def _distance_label(value: Any) -> Optional[str]:
    try:
        metres = float(value)
    except (TypeError, ValueError):
        return None
    if metres <= 50:
        return "direct overlap"
    if metres < 1000:
        return f"{round(metres)} m away"
    return f"{metres / 1000:.1f} km away"


def land_overlay_summary(context: dict[str, Any]) -> dict[str, Any]:
    protected_count = _as_int(context.get("protected_area_count"))
    kba_count = _as_int(context.get("kba_count"))
    ibra_count = _as_int(context.get("ibra_count"))
    ibra_names = context.get("ibra_region_names") if isinstance(context.get("ibra_region_names"), list) else []

    protected_label = "No protected area overlap"
    if protected_count:
        protected_label = f"{protected_count} protected area{'s' if protected_count != 1 else ''}"
        nearest = _distance_label(context.get("protected_area_nearest_m"))
        if nearest:
            protected_label = f"{protected_label} | nearest {nearest}"

    kba_label = "No key biodiversity overlap"
    if kba_count:
        kba_label = f"{kba_count} key biodiversity area{'s' if kba_count != 1 else ''}"
        nearest = _distance_label(context.get("kba_nearest_m"))
        if nearest:
            kba_label = f"{kba_label} | nearest {nearest}"

    bioregion_label = "No bioregion overlap"
    if ibra_count:
        first = next((str(name) for name in ibra_names if name), "")
        bioregion_label = first or f"{ibra_count} bioregion{'s' if ibra_count != 1 else ''}"
        if ibra_count > 1:
            bioregion_label = f"{bioregion_label} + {ibra_count - 1} more"

    return {
        "protected_area_count": protected_count,
        "protected_area_label": protected_label,
        "bioregion_count": ibra_count,
        "bioregion_label": bioregion_label,
        "kba_count": kba_count,
        "kba_label": kba_label,
        "source": context.get("source") or "postgis",
        "error": context.get("error"),
    }


def _run_count_query(conn, context: dict[str, Any], layer: str, sql: str, lon: float, lat: float, radius_m: float) -> dict[str, Any]:
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(sql, (lon, lat, radius_m))
        return cur.fetchone() or {}
    except Exception as error:
        try:
            conn.rollback()
        except Exception:
            pass
        context.setdefault("errors", []).append(f"{layer}: {error}")
        return {}
    finally:
        cur.close()


def query_land_context(lat: float, lon: float, radius_km: float) -> dict[str, Any]:
    context: dict[str, Any] = {
        "source": "postgis",
        "radius_km": radius_km,
        "protected_area_count": 0,
        "protected_area_direct_count": 0,
        "protected_area_nearest_m": None,
        "protected_area_iucn_categories": [],
        "kba_count": 0,
        "kba_direct_count": 0,
        "kba_nearest_m": None,
        "ibra_count": 0,
        "ibra_region_names": [],
    }
    conn = None
    try:
        conn = get_conn()
        radius_m = radius_km * 1000
        capad = _run_count_query(
            conn,
            context,
            "capad",
            """
            WITH params AS (
                SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS point,
                       %s::double precision AS radius_m
            )
            SELECT COUNT(*)::int AS count,
                   COALESCE(SUM(CASE WHEN ST_Intersects(geometry, params.point) THEN 1 ELSE 0 END), 0)::int AS direct_count,
                   MIN(ST_Distance(geometry::geography, params.point::geography)) AS nearest_m,
                   ARRAY_REMOVE(ARRAY_AGG(DISTINCT iucn_category), NULL) AS iucn_categories
            FROM capad_protected_areas, params
            WHERE ST_DWithin(geometry::geography, params.point::geography, params.radius_m);
            """,
            lon,
            lat,
            radius_m,
        )
        context.update({
            "protected_area_count": _as_int(capad.get("count")),
            "protected_area_direct_count": _as_int(capad.get("direct_count")),
            "protected_area_nearest_m": float(capad["nearest_m"]) if capad.get("nearest_m") is not None else None,
            "protected_area_iucn_categories": list(capad.get("iucn_categories") or []),
        })

        kba = _run_count_query(
            conn,
            context,
            "kba",
            """
            WITH params AS (
                SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS point,
                       %s::double precision AS radius_m
            )
            SELECT COUNT(*)::int AS count,
                   COALESCE(SUM(CASE WHEN ST_Intersects(geometry, params.point) THEN 1 ELSE 0 END), 0)::int AS direct_count,
                   MIN(ST_Distance(geometry::geography, params.point::geography)) AS nearest_m
            FROM kba_sites, params
            WHERE ST_DWithin(geometry::geography, params.point::geography, params.radius_m);
            """,
            lon,
            lat,
            radius_m,
        )
        context.update({
            "kba_count": _as_int(kba.get("count")),
            "kba_direct_count": _as_int(kba.get("direct_count")),
            "kba_nearest_m": float(kba["nearest_m"]) if kba.get("nearest_m") is not None else None,
        })

        ibra = _run_count_query(
            conn,
            context,
            "ibra",
            """
            WITH params AS (
                SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS point,
                       %s::double precision AS radius_m
            )
            SELECT COUNT(*)::int AS count,
                   ARRAY_REMOVE(ARRAY_AGG(DISTINCT region_name), NULL) AS region_names
            FROM ibra_regions, params
            WHERE ST_DWithin(geometry::geography, params.point::geography, params.radius_m);
            """,
            lon,
            lat,
            radius_m,
        )
        context.update({
            "ibra_count": _as_int(ibra.get("count")),
            "ibra_region_names": list(ibra.get("region_names") or [])[:5],
        })
        if context.get("errors"):
            context["error"] = "; ".join(context["errors"])
        return context
    except Exception as error:
        context["error"] = str(error)
        return context
    finally:
        if conn is not None:
            conn.close()


def load_land_result(location_hash: str) -> Optional[dict[str, Any]]:
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        ensure_nature_score_tables(cur)
        cur.execute(
            """
            SELECT context_json, land_signal_counts_json, overlay_summary_json,
                   land_score, protected_area_score, ecological_priority_score,
                   updated_at
            FROM land_signal_result
            WHERE location_hash = %s
            ORDER BY updated_at DESC
            LIMIT 1;
            """,
            (location_hash,),
        )
        row = cur.fetchone()
        conn.commit()
        if not row:
            return None
        return {
            "context": row.get("context_json") if isinstance(row.get("context_json"), dict) else {},
            "counts": row.get("land_signal_counts_json") if isinstance(row.get("land_signal_counts_json"), dict) else {},
            "summary": row.get("overlay_summary_json") if isinstance(row.get("overlay_summary_json"), dict) else {},
            "scores": {
                "land_signals": float(row["land_score"]),
                "protected_area_exposure": float(row["protected_area_score"]),
                "ecological_priority": float(row["ecological_priority_score"]),
            },
            "source": "persisted",
            "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
        }
    except Exception:
        if conn is not None:
            conn.rollback()
        return None
    finally:
        if conn is not None:
            conn.close()


def persist_land_result(query_id: Optional[str], location: dict[str, Any], context: dict[str, Any], summary: dict[str, Any], scores: dict[str, float]) -> None:
    location_hash = spatial_location_hash(float(location["lat"]), float(location["lon"]), float(location.get("radius_km") or 10.0))
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_nature_score_tables(cur)
        cur.execute(
            """
            INSERT INTO land_signal_result (
                query_id, location_hash, latitude, longitude, radius_km,
                location_json, context_json, land_signal_counts_json,
                overlay_summary_json, land_score, protected_area_score, ecological_priority_score
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (location_hash) DO UPDATE SET
                query_id = COALESCE(EXCLUDED.query_id, land_signal_result.query_id),
                location_json = EXCLUDED.location_json,
                context_json = EXCLUDED.context_json,
                land_signal_counts_json = EXCLUDED.land_signal_counts_json,
                overlay_summary_json = EXCLUDED.overlay_summary_json,
                land_score = EXCLUDED.land_score,
                protected_area_score = EXCLUDED.protected_area_score,
                ecological_priority_score = EXCLUDED.ecological_priority_score,
                updated_at = NOW();
            """,
            (
                query_id,
                location_hash,
                location["lat"],
                location["lon"],
                location.get("radius_km") or 10.0,
                Json(location),
                Json(context),
                Json(land_signal_counts_from_context(context)),
                Json(summary),
                scores["land_signals"],
                scores["protected_area_exposure"],
                scores["ecological_priority"],
            ),
        )
        conn.commit()
    except Exception:
        if conn is not None:
            conn.rollback()
    finally:
        if conn is not None:
            conn.close()


def build_nature_score_result(
    *,
    query_id: Optional[str],
    spatial_payload: dict[str, Any],
    analysis_payload: Optional[dict[str, Any]],
    force_land_refresh: bool = False,
) -> dict[str, Any]:
    location = canonical_location(spatial_payload)
    if not location:
        return spatial_payload

    location_hash = spatial_location_hash(location["lat"], location["lon"], location["radius_km"])
    persisted_land = None if force_land_refresh else load_land_result(location_hash)
    if persisted_land:
        context = persisted_land["context"]
        summary = persisted_land["summary"]
        land_scores = persisted_land["scores"]
        land_source = "persisted"
    else:
        context = query_land_context(location["lat"], location["lon"], location["radius_km"])
        summary = land_overlay_summary(context)
        land_scores = land_signal_score(context)
        land_source = "computed"
        persist_land_result(query_id, location, context, summary, land_scores)

    evidence_signature = evidence_input_signature(analysis_payload)
    records = evidence_records_from_analysis(analysis_payload)
    analysis_complete = isinstance(analysis_payload, dict) and (
        isinstance(analysis_payload.get("news"), dict)
        or isinstance(analysis_payload.get("reports"), dict)
        or isinstance(analysis_payload.get("analysis_evidence"), dict)
    )

    payload_for_score = {
        **spatial_payload,
        "query_id": query_id or spatial_payload.get("query_id"),
        "location": spatial_payload.get("location") or location,
        "inferred_location": spatial_payload.get("inferred_location") or location,
        "score_context": context,
        "land_signal_counts": land_signal_counts_from_context(context),
        "overlay_summary": summary,
        "nature_signal_counts": nature_signal_counts_from_payload(spatial_payload, context),
        "land_signal_score": land_scores["land_signals"],
        "protected_area_score": land_scores["protected_area_exposure"],
        "ecological_priority_score": land_scores["ecological_priority"],
        "species_score": float(spatial_payload.get("species_threat_score") or 0),
        "land_signal_source": land_source,
    }

    combined = combined_biodiversity_score(
        species_threat_score=payload_for_score.get("species_threat_score"),
        evidence_records=records,
        candidate_count=evidence_signature["candidate_count"],
        spatial_payload=payload_for_score,
        analysis_complete=analysis_complete,
    )
    score_breakdown = {
        **combined,
        "evidence_input_signature": evidence_signature,
        "news_evidence_count": evidence_signature["news_evidence_count"],
        "report_evidence_count": evidence_signature["report_evidence_count"],
        "uploaded_report_count": evidence_signature["uploaded_report_count"],
        "analysed_report_count": evidence_signature["analysed_report_count"],
    }
    return {
        **payload_for_score,
        "status": "success",
        "generated_at": payload_for_score.get("generated_at") or datetime.now(timezone.utc).isoformat(),
        "score_version": combined["score_version"],
        "score_status": combined["score_status"],
        "final_score": combined["final_score"],
        "risk_band": combined["risk_band"],
        "confidence_score": combined["confidence_score"],
        "score_drivers": combined["drivers"],
        "score_summary": combined["plain_language_summary"],
        "combined_biodiversity_score": combined["combined_score"],
        "combined_score_breakdown": score_breakdown,
        "nature_score_source": "canonical_engine",
        "location_hash": location_hash,
    }


def has_complete_land_signals(result: dict[str, Any]) -> bool:
    return (
        isinstance(result.get("score_context"), dict)
        and isinstance(result.get("nature_signal_counts"), dict)
        and all(key in result["score_context"] for key in ("protected_area_count", "kba_count", "ibra_count"))
        and all(key in result["nature_signal_counts"] for key in ("protected_area_count", "kba_count", "bioregion_count"))
        and isinstance(result.get("land_signal_score"), (int, float))
    )


def is_current_canonical_result(result: dict[str, Any], analysis_payload: Optional[dict[str, Any]] = None) -> bool:
    if not isinstance(result, dict) or result.get("status") != "success":
        return False
    if result.get("score_version") != SCORE_VERSION:
        return False
    if not has_complete_land_signals(result):
        return False
    if isinstance(analysis_payload, dict) and analysis_payload:
        current = evidence_input_signature(analysis_payload)
        previous = result.get("combined_score_breakdown", {}).get("evidence_input_signature")
        if isinstance(previous, dict):
            for key, value in current.items():
                if int(previous.get(key) or 0) != int(value or 0):
                    return False
        if result.get("score_status") != "final":
            return False
    return True


def load_nature_score_result(query_id: str) -> dict[str, Any]:
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        ensure_nature_score_tables(cur)
        cur.execute(
            """
            SELECT result_json
            FROM nature_score_result
            WHERE query_id = %s
              AND score_version = %s
            ORDER BY updated_at DESC
            LIMIT 1;
            """,
            (query_id, SCORE_VERSION),
        )
        row = cur.fetchone()
        conn.commit()
        result = row.get("result_json") if row else None
        return result if isinstance(result, dict) else {}
    except Exception:
        if conn is not None:
            conn.rollback()
        return {}
    finally:
        if conn is not None:
            conn.close()


def persist_nature_score_result(query_id: str, result: dict[str, Any]) -> None:
    location = canonical_location(result)
    if not location:
        return
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_nature_score_tables(cur)
        score_json = result.get("combined_score_breakdown") if isinstance(result.get("combined_score_breakdown"), dict) else {}
        cur.execute(
            """
            INSERT INTO nature_score_result (
                query_id, score_version, status, score_status, location_hash,
                latitude, longitude, radius_km, location_json, species_json,
                land_json, evidence_json, score_json, result_json
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (query_id, score_version, location_hash) DO UPDATE SET
                status = EXCLUDED.status,
                score_status = EXCLUDED.score_status,
                location_json = EXCLUDED.location_json,
                species_json = EXCLUDED.species_json,
                land_json = EXCLUDED.land_json,
                evidence_json = EXCLUDED.evidence_json,
                score_json = EXCLUDED.score_json,
                result_json = EXCLUDED.result_json,
                updated_at = NOW();
            """,
            (
                query_id,
                result.get("score_version") or SCORE_VERSION,
                result.get("status") or "success",
                result.get("score_status") or "partial_spatial",
                result.get("location_hash") or spatial_location_hash(location["lat"], location["lon"], location["radius_km"]),
                location["lat"],
                location["lon"],
                location["radius_km"],
                Json(location),
                Json({
                    "total_ala_records": result.get("total_ala_records"),
                    "unique_species_count": result.get("unique_species_count"),
                    "iucn_assessed_species": result.get("iucn_assessed_species"),
                    "threatened_species_count": result.get("threatened_species_count"),
                    "species_threat_score": result.get("species_threat_score"),
                    "score_breakdown": result.get("score_breakdown"),
                }),
                Json({
                    "score_context": result.get("score_context") or {},
                    "land_signal_counts": result.get("land_signal_counts") or {},
                    "nature_signal_counts": result.get("nature_signal_counts") or {},
                    "overlay_summary": result.get("overlay_summary") or {},
                    "land_signal_score": result.get("land_signal_score"),
                    "protected_area_score": result.get("protected_area_score"),
                    "ecological_priority_score": result.get("ecological_priority_score"),
                }),
                Json(score_json.get("evidence_input_signature") or {}),
                Json(score_json),
                Json(result),
            ),
        )
        conn.commit()
    except Exception:
        if conn is not None:
            conn.rollback()
    finally:
        if conn is not None:
            conn.close()
