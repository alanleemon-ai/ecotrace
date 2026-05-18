from backend_clean.app.providers.biodiversity.layer_a import (
    SpeciesRecord,
    calculate_species_threat_score,
    lookup_ala_species_image,
)


def species(category: str, records: int = 10) -> SpeciesRecord:
    return SpeciesRecord(
        scientific_name=f"Species {category} {records}",
        common_name=None,
        taxon_rank="species",
        record_count=records,
        iucn_category=category,
        iucn_category_name=category,
        threat_weight=0.0,
        iucn_url=None,
    )


def test_five_threatened_species_out_of_48_is_not_critical():
    assessed = [species("VU", records=500) for _ in range(5)]
    assessed.extend(species("LC", records=500) for _ in range(43))

    score = calculate_species_threat_score(assessed)

    assert 20 <= score < 35


def test_cr_en_heavy_mix_scores_higher_than_vulnerable_only():
    vulnerable_only = [species("VU") for _ in range(5)] + [species("LC") for _ in range(43)]
    severe_mix = [species("CR") for _ in range(2)]
    severe_mix.extend(species("EN") for _ in range(3))
    severe_mix.extend(species("LC") for _ in range(43))

    assert calculate_species_threat_score(severe_mix) > calculate_species_threat_score(vulnerable_only)


def test_no_threatened_species_scores_zero():
    assessed = [species("LC", records=100) for _ in range(50)]

    assert calculate_species_threat_score(assessed) == 0.0


def test_lookup_ala_species_image_maps_metadata(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "results": [
                    {
                        "id": "image-123",
                        "thumbnailUrl": "https://example.com/thumb.jpg",
                        "largeImageUrl": "https://example.com/large.jpg",
                        "dataResourceName": "ALA species sightings",
                        "creator": "Example Photographer",
                        "recognisedLicence": "CC BY 4.0",
                    }
                ]
            }

    lookup_ala_species_image.cache_clear()
    monkeypatch.setattr(
        "backend_clean.app.providers.biodiversity.layer_a.requests.get",
        lambda *args, **kwargs: FakeResponse(),
    )

    image = lookup_ala_species_image("Pteropus poliocephalus")

    assert image["image_url"] == "https://example.com/large.jpg"
    assert image["image_thumbnail_url"] == "https://example.com/thumb.jpg"
    assert image["image_attribution"] == "Example Photographer | ALA species sightings | CC BY 4.0"


def test_lookup_ala_species_image_uses_live_ala_shape(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "images": [
                    {
                        "imageIdentifier": "broad-match",
                        "title": "Pteropus",
                        "originalFilename": "https://example.com/broad.jpg",
                    },
                    {
                        "imageIdentifier": "exact-match",
                        "title": "Pteropus poliocephalus",
                        "originalFilename": "https://example.com/exact.jpg",
                        "source": "Museums Victoria",
                        "creator": "Paul, David",
                        "recognisedLicence": "CC BY-NC 4.0",
                    },
                ]
            }

    lookup_ala_species_image.cache_clear()
    monkeypatch.setattr(
        "backend_clean.app.providers.biodiversity.layer_a.requests.get",
        lambda *args, **kwargs: FakeResponse(),
    )

    image = lookup_ala_species_image("Pteropus poliocephalus")

    assert image["image_url"] == "https://example.com/exact.jpg"
    assert image["image_thumbnail_url"] == "https://example.com/exact.jpg"
    assert image["image_attribution"] == "Paul, David | Museums Victoria | CC BY-NC 4.0"
