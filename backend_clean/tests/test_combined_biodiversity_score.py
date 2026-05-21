from backend_clean.app.services.scoring_service import (
    SCORE_VERSION,
    combined_biodiversity_score,
    evidence_records_from_analysis,
)
from backend_clean.app.services import nature_score_engine


def record(evidence_type: str, activity: str, confidence: float = 0.9, signal: str = "habitat impact"):
    return {
        "evidence_type": evidence_type,
        "activity_type": activity,
        "confidence": confidence,
        "biodiversity_signal": signal,
        "source": "Test Source",
        "source_type": "news",
    }


def spatial_payload(**context):
    return {
        "location": {
            "lat": -37.8,
            "lon": 144.9,
            "radius_km": 10,
            "confidence": "medium",
            "method": "postcode_centroid",
            "source": "abn",
        },
        "unique_species_count": 50,
        "iucn_assessed_species": 20,
        "score_context": context,
    }


def test_combined_score_returns_versioned_backend_score():
    score = combined_biodiversity_score(
        species_threat_score=18.65,
        evidence_records=[],
        spatial_payload=spatial_payload(),
    )

    assert score["score_version"] == SCORE_VERSION
    assert score["score_status"] == "partial_spatial"
    assert score["final_score"] == score["combined_score"]
    assert score["risk_band"] in {"Low", "Medium", "High", "Critical"}
    assert score["weights"]["species_sensitivity"] == 0.30
    assert score["weights"]["land_signals"] == 0.35
    assert score["weights"]["news_regulatory_pressure"] == 0.25
    assert score["components"]["species_sensitivity"] == 18.65
    assert score["species_score"] == 18.65


def test_combined_score_uses_spatial_and_evidence_components():
    evidence = [
        record("biodiversity risk", "mining", signal="threatened habitat impact"),
        record("regulatory signal", "rehabilitation", signal="rehabilitation failures"),
        record("biodiversity risk", "clearing", signal="endangered species habitat clearing"),
    ]

    score = combined_biodiversity_score(
        species_threat_score=18.65,
        evidence_records=evidence,
        candidate_count=10,
        spatial_payload=spatial_payload(
            protected_area_count=2,
            protected_area_direct_count=1,
            protected_area_nearest_m=0,
            kba_count=1,
            kba_nearest_m=1200,
            ibra_count=2,
        ),
        analysis_complete=True,
    )

    assert score["score_status"] == "final"
    assert 45 <= score["combined_score"] < 80
    assert score["species_threat_component"] == 18.65
    assert score["evidence_pressure_component"] > score["species_threat_component"]
    assert score["components"]["land_signals"] > 0
    assert score["land_signal_score"] > 0
    assert score["protected_area_component"] > 0
    assert score["ecological_priority_component"] > 0


def test_biodiversity_actions_reduce_evidence_pressure():
    risky = [record("biodiversity risk", "clearing")]
    mixed = risky + [
        record("biodiversity action", "conservation", signal="conserve and enhance biodiversity"),
        record("biodiversity action", "monitoring", signal="species monitoring program"),
    ]

    risky_score = combined_biodiversity_score(
        species_threat_score=20,
        evidence_records=risky,
        spatial_payload=spatial_payload(),
    )
    mixed_score = combined_biodiversity_score(
        species_threat_score=20,
        evidence_records=mixed,
        spatial_payload=spatial_payload(),
    )

    assert mixed_score["evidence_pressure_component"] < risky_score["evidence_pressure_component"]


def test_extracts_records_from_analysis_payload_shapes():
    analysis = {
        "news": {"evidence": [record("biodiversity risk", "mining")]},
        "reports": {"evidence": [record("regulatory signal", "approval")]},
    }

    assert len(evidence_records_from_analysis(analysis)) == 2


def test_news_candidates_affect_score_even_without_extracted_records():
    no_news = combined_biodiversity_score(
        species_threat_score=10,
        evidence_records=[],
        candidate_count=0,
        spatial_payload=spatial_payload(protected_area_count=0, kba_count=0, ibra_count=1),
        analysis_complete=True,
    )
    with_news = combined_biodiversity_score(
        species_threat_score=10,
        evidence_records=[],
        candidate_count=5,
        spatial_payload=spatial_payload(protected_area_count=0, kba_count=0, ibra_count=1),
        analysis_complete=True,
    )

    assert with_news["evidence_pressure_component"] > no_news["evidence_pressure_component"]
    assert with_news["combined_score"] > no_news["combined_score"]


def test_canonical_nature_score_result_contains_species_land_and_evidence(monkeypatch):
    monkeypatch.setattr(nature_score_engine, "load_land_result", lambda _location_hash: None)
    monkeypatch.setattr(nature_score_engine, "persist_land_result", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        nature_score_engine,
        "query_land_context",
        lambda lat, lon, radius_km: {
            "source": "postgis",
            "radius_km": radius_km,
            "protected_area_count": 2,
            "protected_area_direct_count": 1,
            "protected_area_nearest_m": 0,
            "protected_area_iucn_categories": ["II"],
            "kba_count": 1,
            "kba_direct_count": 0,
            "kba_nearest_m": 1200,
            "ibra_count": 2,
            "ibra_region_names": ["Southern Volcanic Plain", "Naracoorte Coastal Plain"],
        },
    )

    result = nature_score_engine.build_nature_score_result(
        query_id="00000000-0000-0000-0000-000000000001",
        spatial_payload={
            "status": "success",
            "location": {"lat": -37.8, "lon": 144.9, "radius_km": 10, "confidence": "medium"},
            "unique_species_count": 50,
            "iucn_assessed_species": 20,
            "threatened_species_count": 2,
            "threatened_occurrences": [{"id": "occ-1"}],
            "species_threat_score": 18.65,
        },
        analysis_payload={
            "news": {"evidence": [record("biodiversity risk", "clearing")]},
            "reports": {"evidence": []},
        },
    )

    assert result["score_version"] == SCORE_VERSION
    assert result["score_status"] == "final"
    assert result["nature_signal_counts"]["threatened_species_count"] == 2
    assert result["nature_signal_counts"]["protected_area_count"] == 2
    assert result["nature_signal_counts"]["kba_count"] == 1
    assert result["nature_signal_counts"]["bioregion_count"] == 2
    assert result["land_signal_score"] > 0
    assert result["final_score"] == result["combined_biodiversity_score"]
