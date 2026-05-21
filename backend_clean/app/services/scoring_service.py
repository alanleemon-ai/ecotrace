from __future__ import annotations

from typing import Any, Iterable


SCORE_VERSION = "biodiversity-risk-v1.3-evidence-land-species"

SCORING_WEIGHTS = {
    "species_sensitivity": 0.30,
    "land_signals": 0.35,
    "news_regulatory_pressure": 0.25,
    "data_gap": 0.10,
}


def clamp_score(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, value))


def confidence_value(record: dict[str, Any]) -> float:
    raw = record.get("confidence")
    if raw is None:
        raw = record.get("llm_confidence")
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return 0.6
    if value > 1:
        value = value / 100
    return clamp_score(value, 0.0, 1.0)


def _record_key(record: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(record.get("source_url") or record.get("url") or "").strip().lower(),
        str(record.get("source") or "").strip().lower(),
        str(record.get("evidence_type") or "").strip().lower(),
        str(record.get("biodiversity_signal") or "").strip().lower(),
    )


def _section_evidence_records(section: Any) -> list[dict[str, Any]]:
    if isinstance(section, list):
        return [item for item in section if isinstance(item, dict)]
    if not isinstance(section, dict):
        return []
    for key in ("evidence", "records", "findings"):
        records = section.get(key)
        if isinstance(records, list):
            return [item for item in records if isinstance(item, dict)]
    return []


def evidence_records_from_analysis(analysis_payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(analysis_payload, dict):
        return []
    records: list[dict[str, Any]] = []
    for section_name in ("news", "reports"):
        records.extend(_section_evidence_records(analysis_payload.get(section_name)))
    nested = analysis_payload.get("analysis_evidence")
    if isinstance(nested, dict):
        for section_name in ("news", "reports"):
            records.extend(_section_evidence_records(nested.get(section_name)))
    metadata = analysis_payload.get("metadata_json")
    if isinstance(metadata, dict):
        records.extend(evidence_records_from_analysis(metadata))

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for record in records:
        key = _record_key(record)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)
    return deduped


def evidence_candidates_from_analysis(analysis_payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(analysis_payload, dict):
        return []
    candidates: list[dict[str, Any]] = []
    news = analysis_payload.get("news")
    if isinstance(news, dict):
        for key in ("candidates", "classified_articles"):
            values = news.get(key)
            if isinstance(values, list):
                candidates.extend(item for item in values if isinstance(item, dict))
    nested = analysis_payload.get("analysis_evidence")
    if isinstance(nested, dict):
        values = nested.get("news_candidates")
        if isinstance(values, list):
            candidates.extend(item for item in values if isinstance(item, dict))
    metadata = analysis_payload.get("metadata_json")
    if isinstance(metadata, dict):
        candidates.extend(evidence_candidates_from_analysis(metadata))

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate.get("url") or candidate.get("source_url") or candidate.get("title") or "").strip().lower()
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        deduped.append(candidate)
    return deduped


def evidence_input_signature(analysis_payload: dict[str, Any] | None) -> dict[str, int]:
    records = evidence_records_from_analysis(analysis_payload)
    candidates = evidence_candidates_from_analysis(analysis_payload)
    news_records = [
        record for record in records
        if str(record.get("source_type") or "").lower() != "report"
    ]
    report_records = [
        record for record in records
        if str(record.get("source_type") or "").lower() == "report"
    ]
    uploaded_reports = analysis_payload.get("uploaded_reports") if isinstance(analysis_payload, dict) else None
    analysed_reports = analysis_payload.get("analysed_reports") if isinstance(analysis_payload, dict) else None
    return {
        "evidence_record_count": len(records),
        "news_evidence_count": len(news_records),
        "report_evidence_count": len(report_records),
        "candidate_count": len(candidates),
        "uploaded_report_count": len(uploaded_reports) if isinstance(uploaded_reports, list) else 0,
        "analysed_report_count": len(analysed_reports) if isinstance(analysed_reports, list) else 0,
    }


def evidence_pressure_score(records: Iterable[dict[str, Any]]) -> tuple[float, dict[str, float]]:
    positive_impacts: list[float] = []
    action_relief = 0.0
    regulatory_count = 0
    risk_count = 0
    action_count = 0

    for record in records:
        evidence_type = str(record.get("evidence_type") or "").lower()
        activity = str(record.get("activity_type") or "").lower()
        signal = str(record.get("biodiversity_signal") or "").lower()
        confidence = 0.5 + confidence_value(record) / 2

        impact = 0.0
        if "regulatory" in evidence_type:
            impact += 26
            regulatory_count += 1
        elif "risk" in evidence_type:
            impact += 24
            risk_count += 1
        elif "unknown" in evidence_type:
            impact += 8

        if "action" in evidence_type:
            action_count += 1
            action_relief += 10 * confidence

        if any(term in activity for term in ("clearing", "deforestation", "mining", "drilling", "dam collapse")):
            impact += 14
        elif any(term in activity for term in ("rehabilitation", "restoration", "conservation", "monitoring", "offset")):
            action_relief += 6 * confidence

        if any(term in signal for term in ("critically endangered", "endangered", "threatened", "koala", "habitat", "deforestation", "clearing", "fish kill", "rehabilitation failures")):
            impact += 10

        if impact > 0:
            positive_impacts.append(impact * confidence)

    positive_impacts.sort(reverse=True)
    positive_pressure = sum(
        impact * (0.72 ** index)
        for index, impact in enumerate(positive_impacts[:8])
    )

    score = 25 + min(65, positive_pressure) - min(18, action_relief)
    score = clamp_score(score, 5, 95)
    return round(score, 2), {
        "risk_records": float(risk_count),
        "regulatory_records": float(regulatory_count),
        "action_records": float(action_count),
        "positive_pressure": round(min(65, positive_pressure), 2),
        "action_relief": round(min(18, action_relief), 2),
    }


def evidence_coverage_score(records: Iterable[dict[str, Any]], candidate_count: int = 0) -> float:
    materialized = list(records)
    sources = {
        str(record.get("source") or record.get("source_url") or "").strip().lower()
        for record in materialized
        if record.get("source") or record.get("source_url")
    }
    report_records = sum(1 for record in materialized if record.get("source_type") == "report")
    score = len(materialized) * 10 + len(sources) * 6 + min(15, candidate_count * 1.5)
    if report_records:
        score += 10
    return round(clamp_score(score, 0, 100), 2)


def risk_band(score: float) -> str:
    if score >= 85:
        return "Critical"
    if score >= 70:
        return "High"
    if score >= 45:
        return "Medium"
    return "Low"


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _features_count(collection: Any) -> int:
    if isinstance(collection, dict):
        if isinstance(collection.get("count"), int):
            return collection["count"]
        features = collection.get("features")
        if isinstance(features, list):
            return len(features)
    return 0


def _nearest_distance(collection: Any) -> float | None:
    if not isinstance(collection, dict):
        return None
    distances: list[float] = []
    for feature in collection.get("features") or []:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") or {}
        distance = properties.get("distance_m")
        if distance is None:
            distance = feature.get("distance_m")
        try:
            distances.append(float(distance))
        except (TypeError, ValueError):
            continue
    return min(distances) if distances else None


def _spatial_context(spatial_payload: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(spatial_payload, dict):
        return {}
    context = spatial_payload.get("score_context")
    if isinstance(context, dict):
        return context
    context = spatial_payload.get("spatial_score_context")
    if isinstance(context, dict):
        return context

    layers = spatial_payload.get("layers")
    if isinstance(layers, dict):
        return {
            "protected_area_count": _features_count(layers.get("capad")),
            "protected_area_nearest_m": _nearest_distance(layers.get("capad")),
            "kba_count": _features_count(layers.get("kba")),
            "kba_nearest_m": _nearest_distance(layers.get("kba")),
            "ibra_count": _features_count(layers.get("ibra")),
            "source": "overlay_layers",
        }
    return {}


def protected_area_exposure_score(context: dict[str, Any]) -> float:
    count = _as_int(context.get("protected_area_count"))
    nearest_m = context.get("protected_area_nearest_m")
    direct_count = _as_int(context.get("protected_area_direct_count"))
    iucn_categories = context.get("protected_area_iucn_categories") or []

    score = min(72.0, count * 18.0) + min(18.0, direct_count * 12.0)
    try:
        nearest = float(nearest_m)
    except (TypeError, ValueError):
        nearest = None
    if nearest is not None:
        if nearest <= 50:
            score += 24
        elif nearest <= 1000:
            score += 16
        elif nearest <= 5000:
            score += 8
    if any(str(category).upper() in {"IA", "IB", "II", "III", "IV"} for category in iucn_categories):
        score += 8
    return round(clamp_score(score), 2)


def ecological_priority_score(context: dict[str, Any]) -> float:
    kba_count = _as_int(context.get("kba_count"))
    kba_direct_count = _as_int(context.get("kba_direct_count"))
    ibra_count = _as_int(context.get("ibra_count"))
    nearest_m = context.get("kba_nearest_m")

    score = min(76.0, kba_count * 32.0) + min(24.0, kba_direct_count * 18.0)
    try:
        nearest = float(nearest_m)
    except (TypeError, ValueError):
        nearest = None
    if nearest is not None:
        if nearest <= 50:
            score += 18
        elif nearest <= 1000:
            score += 12
        elif nearest <= 5000:
            score += 6

    # IBRA is mainly context rather than direct risk, so it gets a small cap.
    score += min(12.0, ibra_count * 4.0)
    return round(clamp_score(score), 2)


def land_signal_score(context: dict[str, Any]) -> dict[str, float]:
    protected_score = protected_area_exposure_score(context)
    priority_score = ecological_priority_score(context)
    score = protected_score * 0.60 + priority_score * 0.40
    return {
        "land_signals": round(clamp_score(score), 2),
        "protected_area_exposure": protected_score,
        "ecological_priority": priority_score,
    }


def location_confidence_score(spatial_payload: dict[str, Any] | None) -> float:
    if not isinstance(spatial_payload, dict):
        return 35.0
    location = spatial_payload.get("inferred_location") or spatial_payload.get("location") or {}
    confidence = str(location.get("confidence") or "").lower()
    method = str(location.get("method") or "").lower()
    source = str(location.get("source") or "").lower()

    if confidence == "high":
        score = 90.0
    elif confidence == "medium":
        score = 70.0
    elif confidence == "low":
        score = 45.0
    else:
        score = 55.0

    if "postcode" in method or "centroid" in method:
        score = min(score, 62.0)
    if source == "abn":
        score = min(score, 68.0)
    if location.get("lat") is None or location.get("lon") is None:
        score = 25.0
    return round(clamp_score(score), 2)


def confidence_score(
    *,
    spatial_payload: dict[str, Any] | None,
    records: list[dict[str, Any]],
    candidate_count: int,
) -> float:
    location_score = location_confidence_score(spatial_payload)
    unique_species = _as_int((spatial_payload or {}).get("unique_species_count"))
    assessed_species = _as_int((spatial_payload or {}).get("iucn_assessed_species"))
    if unique_species:
        species_score = min(95.0, 35.0 + min(40.0, assessed_species * 1.4) + min(20.0, (assessed_species / unique_species) * 20.0))
    else:
        species_score = 30.0

    if records:
        avg_confidence = sum(confidence_value(record) for record in records) / len(records)
        evidence_quality = 45.0 + avg_confidence * 45.0
    elif candidate_count:
        evidence_quality = min(70.0, 38.0 + candidate_count * 4.0)
    else:
        evidence_quality = 28.0

    sources = {
        str(record.get("source") or record.get("source_url") or "").strip().lower()
        for record in records
        if record.get("source") or record.get("source_url")
    }
    source_coverage = min(95.0, 30.0 + len(sources) * 10.0 + min(25.0, candidate_count * 1.2))

    score = (
        location_score * 0.35
        + species_score * 0.25
        + evidence_quality * 0.25
        + source_coverage * 0.15
    )
    return round(clamp_score(score), 2)


def score_drivers(
    *,
    components: dict[str, float],
    spatial_context: dict[str, Any],
    spatial_payload: dict[str, Any] | None,
    evidence_record_count: int,
    candidate_count: int,
) -> list[dict[str, Any]]:
    threatened_species_count = _as_int((spatial_payload or {}).get("threatened_species_count"))
    return [
        {
            "key": "species_sensitivity",
            "label": "Species score",
            "value": threatened_species_count,
            "score": components["species_sensitivity"],
            "detail": f"{threatened_species_count} CR/EN/VU species from ALA records enriched with IUCN Red List status.",
        },
        {
            "key": "land_signals",
            "label": "Land signals",
            "value": (
                int(spatial_context.get("protected_area_count") or 0)
                + int(spatial_context.get("kba_count") or 0)
                + int(spatial_context.get("ibra_count") or 0)
            ),
            "score": components["land_signals"],
            "detail": "CAPAD protected areas, KBA priority places, and IBRA bioregions around the computed location.",
        },
        {
            "key": "news_regulatory_pressure",
            "label": "Evidence pressure",
            "value": evidence_record_count,
            "score": components["news_regulatory_pressure"],
            "detail": f"{evidence_record_count} extracted evidence records and {candidate_count} reviewed candidates.",
        },
        {
            "key": "data_gap",
            "label": "Data confidence gap",
            "value": round(components["data_gap"], 2),
            "score": components["data_gap"],
            "detail": "Uncertainty from location precision, source coverage, and evidence quality.",
        },
    ]


def score_summary_text(score: float, band: str, status: str, drivers: list[dict[str, Any]]) -> str:
    strongest = max(drivers, key=lambda item: float(item.get("score") or 0), default=None)
    prefix = "Final" if status == "final" else "Partial spatial"
    if strongest and float(strongest.get("score") or 0) > 0:
        return (
            f"{prefix} nature risk score is {round(score)}/100 ({band}). "
            f"The strongest current driver is {strongest['label'].lower()}."
        )
    return (
        f"{prefix} nature risk score is {round(score)}/100 ({band}). "
        "No strong biodiversity pressure driver was detected from the current sources."
    )


def combined_biodiversity_score(
    *,
    species_threat_score: float | int | None,
    evidence_records: list[dict[str, Any]] | None = None,
    candidate_count: int = 0,
    spatial_payload: dict[str, Any] | None = None,
    analysis_complete: bool = False,
) -> dict[str, Any]:
    species_score = clamp_score(_as_float(species_threat_score))
    records = evidence_records or []
    evidence_score, evidence_breakdown = evidence_pressure_score(records)
    coverage_score = evidence_coverage_score(records, candidate_count)
    context = _spatial_context(spatial_payload)

    land_scores = land_signal_score(context)
    protected_score = land_scores["protected_area_exposure"]
    priority_score = land_scores["ecological_priority"]
    news_pressure = evidence_score if records else min(45.0, candidate_count * 6.0)
    confidence = confidence_score(
        spatial_payload=spatial_payload,
        records=records,
        candidate_count=candidate_count,
    )
    data_gap = 100.0 - confidence
    components = {
        "species_sensitivity": round(species_score, 2),
        "land_signals": land_scores["land_signals"],
        "news_regulatory_pressure": round(clamp_score(news_pressure), 2),
        "data_gap": round(clamp_score(data_gap), 2),
    }
    combined = sum(components[key] * SCORING_WEIGHTS[key] for key in SCORING_WEIGHTS)

    missing_flags: list[str] = []
    if not context:
        missing_flags.append("spatial_overlay_context")
    if not records and candidate_count:
        missing_flags.append("news_candidates_without_extracted_evidence")
    if not records and not candidate_count:
        missing_flags.append("news_and_report_evidence")
    if location_confidence_score(spatial_payload) < 65:
        missing_flags.append("precise_company_location")
    status = "final" if analysis_complete else "partial_spatial"
    band = risk_band(combined)
    final_score = round(clamp_score(combined), 2)
    drivers = score_drivers(
        components=components,
        spatial_context=context,
        spatial_payload=spatial_payload,
        evidence_record_count=len(records),
        candidate_count=candidate_count,
    )

    return {
        "score_version": SCORE_VERSION,
        "score_status": status,
        "final_score": final_score,
        "combined_score": final_score,
        "risk_band": band,
        "confidence_score": confidence,
        "components": components,
        "drivers": drivers,
        "plain_language_summary": score_summary_text(final_score, band, status, drivers),
        "weights": SCORING_WEIGHTS,
        "missing_data_flags": missing_flags,
        "species_threat_component": round(species_score, 2),
        "protected_area_component": protected_score,
        "ecological_priority_component": priority_score,
        "evidence_pressure_component": round(clamp_score(news_pressure), 2),
        "evidence_coverage_component": coverage_score,
        "data_gap_component": round(clamp_score(data_gap), 2),
        "evidence_record_count": len(records),
        "candidate_count": candidate_count,
        "spatial_context": context,
        "species_score": round(species_score, 2),
        "land_signal_score": land_scores["land_signals"],
        **evidence_breakdown,
    }
