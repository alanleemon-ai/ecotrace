import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bird,
  Database,
  ExternalLink,
  Leaf,
  MapPinned,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { PageShell } from "../components/PageShell";
import {
  SpatialContextBar,
  spatialSites,
  type SpatialSite,
} from "../components/spatial-context-bar";
import { FindingsPanel } from "../components/findings-panel";
import { BiodiversityMap, type SpatialOverlaySummary } from "../components/biodiversity-map";
import { Card } from "../components/shared";
import {
  getSpatialAnalysisForQuery,
  getSpatialLayerA,
  type SpatialLayerAResponse,
} from "../../lib/api";
import { evidenceAnalysisComplete, loadCompanyAnalysis, riskLevelFromScore } from "../lib/analysis";

type SourceTone = "emerald" | "sky" | "rose" | "amber";

const trustedSources = [
  {
    label: "ALA",
    title: "Atlas of Living Australia",
    image: "/images/trusted-sources/ala.png",
    description: "Sightings data used to show which species have been recorded near the selected location.",
    usage: "Nearby sightings",
    href: "https://biocache.ala.org.au",
    tone: "emerald" as SourceTone,
    icon: Leaf,
  },
  {
    label: "IUCN",
    title: "IUCN Red List",
    image: "/images/trusted-sources/iucn.png",
    description: "Conservation status data used to identify species that may need closer attention.",
    usage: "Conservation status",
    href: "https://www.iucnredlist.org",
    tone: "rose" as SourceTone,
    icon: ShieldCheck,
  },
  {
    label: "CAPAD",
    title: "Protected Areas",
    image: "/images/trusted-sources/capad.png",
    description: "Protected-area boundaries used to show whether the site sits near conservation land.",
    usage: "Protected areas",
    href: "https://www.dcceew.gov.au/environment/land/nrs/science/capad",
    tone: "sky" as SourceTone,
    icon: MapPinned,
  },
  {
    label: "Spatial",
    title: "IBRA & KBA Layers",
    image: "/images/trusted-sources/spatial.png",
    description: "Regional layers used to explain the broader biodiversity setting around the site.",
    usage: "Regional context",
    href: "https://www.data.gov.au",
    tone: "amber" as SourceTone,
    icon: Database,
  },
];

function formatNumber(value?: number) {
  return new Intl.NumberFormat("en-AU").format(value ?? 0);
}

function spatialRiskLevel(score?: number) {
  return riskLevelFromScore(Math.round(score ?? 0));
}

function spatialRiskTone(score?: number) {
  const level = spatialRiskLevel(score);
  if (level === "Critical" || level === "High") return {
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    panel: "border-rose-200 bg-rose-50/70",
    bar: "bg-rose-500",
  };
  if (level === "Medium") return {
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    panel: "border-amber-200 bg-amber-50/70",
    bar: "bg-amber-500",
  };
  return {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    panel: "border-emerald-200 bg-emerald-50/70",
    bar: "bg-emerald-500",
  };
}

function spatialSummary(layerA: SpatialLayerAResponse | null, site: SpatialSite) {
  const threatened = layerA?.threatened_species_count ?? 0;
  const assessed = layerA?.iucn_assessed_species ?? 0;
  const score = layerA?.species_threat_score ?? 0;

  if (!layerA) {
    return {
      title: "Checking nearby biodiversity",
      body: `Seeco is reviewing species records within ${site.radiusKm} km of this location.`,
      callout: "Waiting for the first spatial result",
    };
  }
  if (threatened === 0) {
    return {
      title: "No threatened species found in the current scan",
      body: `${formatNumber(assessed)} assessed species were checked within ${site.radiusKm} km, and none are currently classified as critically endangered, endangered, or vulnerable.`,
      callout: "Lower nearby species pressure",
    };
  }
  if (score < 35) {
    return {
      title: `${threatened} threatened species found nearby`,
      body: `The current scan found ${threatened} threatened species within ${site.radiusKm} km. That is worth monitoring, but the overall nearby species signal remains low today.`,
      callout: "Monitor, but not an immediate red flag",
    };
  }
  return {
    title: `${threatened} threatened species found nearby`,
    body: `The current scan found ${threatened} threatened species within ${site.radiusKm} km, giving this location a ${spatialRiskLevel(score).toLowerCase()} nearby species-threat signal.`,
    callout: "Review the map and species list before relying on the score",
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function overallNatureSummary(
  layerA: SpatialLayerAResponse | null,
  overlay: SpatialOverlaySummary | null,
  site: SpatialSite,
) {
  if (!layerA || !overlay || overlay.loading) {
    return {
      eyebrow: "Understanding this place",
      title: "Checking the nearby nature signals",
      body: `Seeco is combining wildlife sightings, conservation status, protected land, and regional ecology within ${site.radiusKm} km of this location.`,
      takeaway: "Waiting for the full local picture",
    };
  }

  if (overlay.error) {
    return {
      eyebrow: "Partial result",
      title: "Wildlife results are ready, but land overlays are unavailable",
      body: `The species scan for the ${site.radiusKm} km area is ready, but protected-area, bioregion, and key biodiversity overlays could not be loaded right now.`,
      takeaway: "Review the land signals once overlays return",
    };
  }

  const threatened = layerA.threatened_species_count ?? 0;
  const protectedAreas = overlay?.protectedAreaCount ?? 0;
  const bioregions = overlay?.bioregionCount ?? 0;
  const kbas = overlay?.kbaCount ?? 0;
  const signalParts = [
    pluralize(threatened, "threatened species", "threatened species"),
    pluralize(protectedAreas, "protected area overlap"),
    pluralize(bioregions, "bioregion"),
    pluralize(kbas, "key biodiversity area overlap"),
  ];

  if (threatened > 0 && (protectedAreas > 0 || kbas > 0)) {
    return {
      eyebrow: "What stands out",
      title: "Wildlife and land-protection signals both appear nearby",
      body: `Within ${site.radiusKm} km, this scan found ${signalParts.join(", ")}. Taken together, that means this location deserves a closer look before drawing a simple low-impact conclusion.`,
      takeaway: "Worth a closer review",
    };
  }

  if (threatened > 0) {
    return {
      eyebrow: "What stands out",
      title: "Threatened wildlife appears nearby",
      body: `Within ${site.radiusKm} km, this scan found ${signalParts.join(", ")}. The strongest current signal comes from species records rather than protected-land overlap.`,
      takeaway: "Species are the main watchpoint",
    };
  }

  if (protectedAreas > 0 || kbas > 0) {
    return {
      eyebrow: "What stands out",
      title: "The land context matters even without threatened species nearby",
      body: `Within ${site.radiusKm} km, this scan found ${signalParts.join(", ")}. The current wildlife scan is lighter, but the surrounding conservation setting still matters.`,
      takeaway: "Land context is the main signal",
    };
  }

  return {
    eyebrow: "What stands out",
    title: "The current scan shows a lighter nearby nature signal",
    body: `Within ${site.radiusKm} km, this scan found ${signalParts.join(", ")}. No single local signal is standing out strongly in the current result.`,
    takeaway: "Lower nearby signal today",
  };
}

function ConsumerSignalCard({
  icon: Icon,
  label,
  value,
  detail,
  meaning,
  tone,
  image,
}: {
  icon: any;
  label: string;
  value: string;
  detail: string;
  meaning: string;
  tone: "emerald" | "sky" | "rose" | "amber";
  image: string;
}) {
  const tones = {
    emerald: {
      icon: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      chip: "bg-emerald-50 text-emerald-700",
    },
    sky: {
      icon: "bg-sky-50 text-sky-700 ring-sky-200",
      chip: "bg-sky-50 text-sky-700",
    },
    rose: {
      icon: "bg-rose-50 text-rose-700 ring-rose-200",
      chip: "bg-rose-50 text-rose-700",
    },
    amber: {
      icon: "bg-amber-50 text-amber-700 ring-amber-200",
      chip: "bg-amber-50 text-amber-700",
    },
  } as const;
  const style = tones[tone];

  return (
    <Card className="overflow-hidden">
      <div className="relative h-32 overflow-hidden">
        <img
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950/70 via-stone-950/25 to-transparent" />
        <div className={`absolute left-4 top-4 flex size-9 items-center justify-center rounded-xl ring-1 ${style.icon}`}>
          <Icon className="size-4" />
        </div>
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
          <div className="text-[13px] font-medium text-white">{label}</div>
          <div className="rounded-full bg-white/92 px-2.5 py-1 text-[18px] font-medium tabular-nums text-stone-950">
            {value}
          </div>
        </div>
      </div>
      <div className="p-4">
        <div className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${style.chip}`}>
          {detail}
        </div>
        <p className="mt-3 min-h-[54px] text-[12px] leading-relaxed text-stone-600">{meaning}</p>
      </div>
    </Card>
  );
}

function PlainLanguageGuide() {
  const items = [
    {
      term: "Threatened species",
      meaning: "Animals or plants already considered at higher risk of decline.",
    },
    {
      term: "Protected areas",
      meaning: "Land set aside for conservation, which can increase scrutiny around nearby activity.",
    },
    {
      term: "Bioregions",
      meaning: "Large ecological regions that explain the kind of landscape the site sits within.",
    },
    {
      term: "Key biodiversity areas",
      meaning: "Places recognised as especially important for biodiversity at a larger scale.",
    },
  ];

  return (
    <Card className="p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
        Plain-language guide
      </div>
      <h3 className="mt-2 text-[18px] text-stone-950">What these words mean</h3>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.term} className="border-t border-stone-100 pt-3 first:border-t-0 first:pt-0">
            <div className="text-[13px] font-medium text-stone-900">{item.term}</div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-stone-600">{item.meaning}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TrustedSourcesSection({ layerA }: { layerA?: SpatialLayerAResponse | null }) {
  const toneClasses = {
    emerald: {
      badge: "bg-emerald-50 text-emerald-700",
      wash: "from-emerald-50 to-emerald-100/60",
      stat: "text-emerald-700",
    },
    sky: {
      badge: "bg-sky-50 text-sky-700",
      wash: "from-sky-50 to-sky-100/70",
      stat: "text-sky-700",
    },
    rose: {
      badge: "bg-rose-50 text-rose-700",
      wash: "from-rose-50 to-orange-50",
      stat: "text-rose-700",
    },
    amber: {
      badge: "bg-amber-50 text-amber-700",
      wash: "from-amber-50 to-lime-50",
      stat: "text-amber-700",
    },
  } as const;
  const sourceStats = [
    `${formatNumber(layerA?.total_ala_records)} records queried`,
    `${formatNumber(layerA?.iucn_assessed_species)} assessed species`,
    "CAPAD polygons in database",
    "IBRA + KBA overlays",
  ];
  const refreshedAt = layerA?.generated_at
    ? `Layer A generated ${new Date(layerA.generated_at).toLocaleString("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
      })}`
    : "Waiting for latest Layer A refresh";

  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-800/70">
            Go deeper | trusted sources
          </div>
          <h2 className="mt-1 text-[22px] text-stone-950">Explore the data behind this result</h2>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[11px] text-stone-500">
          <RefreshCw className="size-3" />
          {refreshedAt}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {trustedSources.map((source, index) => {
          const Icon = source.icon;
          const tone = toneClasses[source.tone];
          return (
            <a
              key={source.title}
              href={source.href}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
            >
              <div className={`relative h-28 overflow-hidden border-b border-stone-200 bg-gradient-to-br ${tone.wash}`}>
                <img
                  src={source.image}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-stone-950/45 via-stone-950/10 to-white/5" />
                <div className={`absolute left-3 top-3 rounded-full px-2 py-1 text-[10px] font-semibold ${tone.badge}`}>
                  {source.label}
                </div>
                <div className="absolute bottom-3 right-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-white/88 text-stone-500 shadow-sm ring-1 ring-white">
                    <Icon className="size-7" />
                  </div>
                </div>
              </div>

              <div className="p-4">
                <div className="text-[15px] font-medium text-stone-950">{source.title}</div>
                <p className="mt-2 min-h-[54px] text-[12px] leading-relaxed text-stone-600">
                  {source.description}
                </p>
                <div className="mt-4 border-t border-stone-100 pt-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-stone-600">
                    <ShieldCheck className="size-3.5 text-emerald-600" />
                    {source.usage}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className={`text-[11px] font-medium ${tone.stat}`}>{sourceStats[index]}</span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-stone-500 group-hover:text-emerald-700">
                      Open
                      <ExternalLink className="size-3" />
                    </span>
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function persistSpatialScore(data: SpatialLayerAResponse) {
  if (data.status !== "success" || typeof data.species_threat_score !== "number") return;

  localStorage.setItem("latest_spatial_analysis", JSON.stringify(data));

  try {
    const raw = localStorage.getItem("company_analysis");
    if (!raw) return;

    const analysis = JSON.parse(raw);
    if (!evidenceAnalysisComplete(analysis, data.query_id)) return;
    if (analysis?.query_id && data.query_id && analysis.query_id !== data.query_id) return;
    if (
      typeof analysis?.spatial_analysis?.combined_biodiversity_score === "number" &&
      typeof data.combined_biodiversity_score !== "number"
    ) return;

    localStorage.setItem(
      "company_analysis",
      JSON.stringify({ ...analysis, spatial_analysis: data }),
    );
  } catch {
    // Keep the spatial page usable even if a previous localStorage payload is stale.
  }
}

export function SpatialAnalysisPage() {
  const [site, setSite] = useState<SpatialSite>(spatialSites[0]);
  const [layerA, setLayerA] = useState<SpatialLayerAResponse | null>(null);
  const [queryId, setQueryId] = useState<string | null>(() => localStorage.getItem("query_id"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [overlaySummary, setOverlaySummary] = useState<SpatialOverlaySummary | null>(null);
  const analysis = loadCompanyAnalysis();
  const queryEvidenceReady = evidenceAnalysisComplete(analysis, queryId);

  const refreshLayerA = useCallback(() => {
    setForceRefresh(true);
    setRefreshIndex((value) => value + 1);
  }, []);

  const siteFromSpatialResponse = useCallback((data: SpatialLayerAResponse): SpatialSite | null => {
    const inferred = data.inferred_location ?? (data.location && "label" in data.location ? data.location : null);
    const company = data.company;
    if (!inferred || !company) return null;
    const evidenceDerived = [
      "report_or_news_evidence",
      "inferred_location_report",
      "inferred_location_news",
    ].includes(inferred.source || "");
    const sourceLabel = evidenceDerived ? "Source: Extracted evidence" : "Source: ABN Registration";
    const sectorLabel = evidenceDerived
      ? `Evidence location - ${inferred.state || "AU"}`
      : company.state ? `Registered address - ${company.state}` : "Registered address";

    return {
      id: data.query?.query_id || data.query_id || "resolved-query",
      name: inferred.label || `${company.state || "AU"} ${company.postcode || ""}`.trim(),
      lat: inferred.lat,
      lon: inferred.lon,
      radiusKm: inferred.radius_km,
      company: company.legal_name || data.query?.input_value || "Resolved company",
      ticker: company.entity_type || "ABR",
      sector: sectorLabel,
      abn: company.abn || "N/A",
      locationMethod: inferred.method,
      locationConfidence: inferred.confidence,
      sourceTags: [
        { label: sourceLabel, tone: "emerald" as const },
        { label: `Inference: ${inferred.method}`, tone: "blue" as const },
        { label: "Layer A: ALA + IUCN", tone: "amber" as const },
      ],
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let poll: number | undefined;

    setLoading(true);
    setError(null);

    if (queryId && !queryEvidenceReady) {
      setLayerA(null);
      setLoading(false);
      return;
    }

    const request = queryId
      ? getSpatialAnalysisForQuery(queryId, forceRefresh)
      : getSpatialLayerA({
          lat: site.lat,
          lon: site.lon,
          radius_km: site.radiusKm,
          max_species: 50,
        });

    request
      .then((data) => {
        if (!cancelled) {
          setLayerA(data);
          persistSpatialScore(data);
          const dynamicSite = siteFromSpatialResponse(data);
          if (dynamicSite) {
            setSite(dynamicSite);
          }
          if (queryId && data.status === "loading") {
            poll = window.setTimeout(() => {
              setRefreshIndex((value) => value + 1);
            }, 5000);
          }
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setForceRefresh(false);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (poll) window.clearTimeout(poll);
    };
  }, [forceRefresh, queryEvidenceReady, queryId, refreshIndex, site.lat, site.lon, site.radiusKm, siteFromSpatialResponse]);

  const handleSiteChange = (nextSite: SpatialSite) => {
    setQueryId(null);
    setSite(nextSite);
  };

  const siteOptions = queryId ? [site] : spatialSites;
  const spatialLocked = Boolean(queryId && !queryEvidenceReady);
  const riskScore = layerA?.species_threat_score ?? 0;
  const riskLevel = spatialRiskLevel(riskScore);
  const riskTone = spatialRiskTone(riskScore);
  const summary = spatialSummary(layerA, site);
  const overallSummary = overallNatureSummary(layerA, overlaySummary, site);
  const threatenedSpecies = layerA?.threatened_species_count ?? 0;
  const speciesChecked = layerA?.iucn_assessed_species ?? 0;
  const speciesFound = layerA?.unique_species_count ?? 0;
  const nearbySightings = layerA?.total_ala_records ?? 0;
  const mappedThreatenedSightings = layerA?.threatened_occurrences?.length ?? 0;
  const protectedAreaCount = overlaySummary?.protectedAreaCount ?? 0;
  const bioregionCount = overlaySummary?.bioregionCount ?? 0;
  const kbaCount = overlaySummary?.kbaCount ?? 0;
  const overlayPending = !overlaySummary || overlaySummary.loading;
  const overlayUnavailable = Boolean(overlaySummary?.error);

  return (
    <PageShell
      sectionMarker="  SPATIAL ANALYSIS"
      coords={`LAT ${site.lat.toFixed(4)} deg  LON ${site.lon.toFixed(4)} deg  |  RADIUS ${site.radiusKm} KM`}
    >
      <section className="relative mb-6 min-h-[190px] overflow-hidden rounded-2xl text-white md:min-h-[220px]">
        <img
          src="/images/trusted-sources/spatial.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/92 via-emerald-950/72 to-stone-950/25" />
        <div className="relative flex min-h-[190px] flex-col justify-end p-6 md:min-h-[220px] md:p-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-100/90">
            Spatial & protected areas
          </div>
          <h1 className="mt-2 max-w-3xl text-[28px] leading-tight text-white md:text-[34px]">
            How does this company sit within nearby nature?
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-emerald-50/95 md:text-[14px]">
            A plain-language view of wildlife sightings, protected land, ecological regions, and priority biodiversity places around this business.
          </p>
        </div>
      </section>

      <SpatialContextBar site={site} sites={siteOptions} onSiteChange={handleSiteChange} />

      {spatialLocked ? (
        <Card className="p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
            Waiting for location evidence
          </div>
          <div className="mt-2 text-[18px] text-stone-900">
            Nearby nature results will appear after news and report evidence completes.
          </div>
          <div className="mt-1 text-[13px] text-stone-500">
            This keeps the analysis tied to the best-supported company location before showing a result.
          </div>
        </Card>
      ) : (
        <>

      <section className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
            {overallSummary.eyebrow}
          </div>
          <h2 className="mt-2 text-[26px] leading-tight text-stone-950">{overallSummary.title}</h2>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-stone-600">{overallSummary.body}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700">
              {site.name}
            </span>
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700">
              {site.radiusKm} km area checked
            </span>
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700">
              {formatNumber(layerA?.unique_species_count)} species found
            </span>
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700">
              {overlayPending ? "Checking protected areas" : pluralize(protectedAreaCount, "protected area")}
            </span>
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700">
              {overlayPending ? "Checking bioregions" : pluralize(bioregionCount, "bioregion")}
            </span>
          </div>
          <div className="mt-4 rounded-xl bg-stone-50 px-3 py-2 text-[12px] leading-relaxed text-stone-600">
            This does not prove a company is causing harm. It shows what is nearby, so a shopper or investor can see what may deserve more attention.
          </div>
        </Card>

        <Card className={`p-5 ${riskTone.panel}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-stone-600">Nearby species threat score</div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${riskTone.badge}`}>
              {riskLevel}
            </span>
          </div>
          <div className="mt-3 flex items-end gap-1">
            <div className="text-[42px] leading-none text-stone-950 tabular-nums">
              {loading && !layerA ? "..." : riskScore.toFixed(1)}
            </div>
            <div className="pb-1 text-[13px] text-stone-500">/100</div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/80">
            <div className={`h-full ${riskTone.bar}`} style={{ width: `${Math.min(100, riskScore)}%` }} />
          </div>
          <div className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-stone-600">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {overallSummary.takeaway}
          </div>
        </Card>
      </section>

      <section className="mb-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
          The nearby signals
        </div>
        <h3 className="mt-1 text-[21px] text-stone-950">What was found around this location</h3>
      </section>

      <section data-tour="spatial-metrics" className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ConsumerSignalCard
          icon={Bird}
          label="Wildlife nearby"
          value={loading && !layerA ? "..." : formatNumber(threatenedSpecies)}
          detail={`${formatNumber(nearbySightings)} sightings across ${formatNumber(speciesFound)} species`}
          meaning={
            threatenedSpecies > 0
              ? `${pluralize(threatenedSpecies, "threatened species", "threatened species")} were found among ${formatNumber(speciesChecked)} checked species, with ${pluralize(mappedThreatenedSightings, "mapped threatened sighting")}.`
              : `No threatened species were found among ${formatNumber(speciesChecked)} checked species in this scan.`
          }
          tone="rose"
          image="/images/trusted-sources/ala.png"
        />
        <ConsumerSignalCard
          icon={ShieldCheck}
          label="Conservation land nearby"
          value={overlayPending ? "..." : formatNumber(protectedAreaCount)}
          detail={overlaySummary?.protectedAreaLabel ?? "Checking protected areas"}
          meaning={
            overlayUnavailable
              ? "Protected-area data could not be loaded right now."
              : protectedAreaCount > 0
              ? "Protected land overlaps the area checked, which can mean stronger conservation expectations nearby."
              : "No protected-area overlap is currently shown for this search area."
          }
          tone="emerald"
          image="/images/trusted-sources/capad.png"
        />
        <ConsumerSignalCard
          icon={MapPinned}
          label="Landscape setting"
          value={overlayPending ? "..." : formatNumber(bioregionCount)}
          detail={overlaySummary?.bioregionLabel ?? "Checking bioregions"}
          meaning={
            overlayUnavailable
              ? "Bioregion data could not be loaded right now."
              : bioregionCount > 1
              ? "More than one bioregion appears here, suggesting a mixed ecological setting."
              : "Bioregions describe the broader type of landscape around the site."
          }
          tone="sky"
          image="/images/trusted-sources/spatial.png"
        />
        <ConsumerSignalCard
          icon={Database}
          label="Priority biodiversity places"
          value={overlayPending ? "..." : formatNumber(kbaCount)}
          detail={overlaySummary?.kbaLabel ?? "Checking key biodiversity areas"}
          meaning={
            overlayUnavailable
              ? "Key biodiversity-area data could not be loaded right now."
              : kbaCount > 0
              ? "Key biodiversity areas are a stronger conservation-priority signal and deserve early review."
              : "No key biodiversity area overlap is currently shown in the search area."
          }
          tone="amber"
          image="/images/trusted-sources/kba.png"
        />
      </section>

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <BiodiversityMap
            site={site}
            layerA={layerA}
            loading={loading}
            onOverlaySummaryChange={setOverlaySummary}
            showOverview={false}
          />
        </div>
        <div className="lg:col-span-4">
          <PlainLanguageGuide />
        </div>
      </div>

      <section className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
            Read the result
          </div>
          <h3 className="mt-2 text-[20px] text-stone-950">What to take away from this location</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-stone-50 p-4">
              <div className="text-[12px] text-stone-500">Wildlife signal</div>
              <div className="mt-1 text-[15px] font-medium text-stone-950">
                {summary.title}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-stone-600">{summary.body}</p>
            </div>
            <div className="rounded-xl bg-stone-50 p-4">
              <div className="text-[12px] text-stone-500">Land signal</div>
              <div className="mt-1 text-[15px] font-medium text-stone-950">
                {overlayUnavailable
                  ? "Land overlays unavailable right now"
                  : protectedAreaCount > 0 || kbaCount > 0
                  ? "Conservation context is present nearby"
                  : "No stronger conservation-area overlap is currently shown"}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-stone-600">
                {overlayUnavailable
                  ? "The species result is available, but protected-area and broader landscape overlays could not be loaded in this view."
                  : protectedAreaCount > 0 || kbaCount > 0
                  ? `${pluralize(protectedAreaCount, "protected area overlap")} and ${pluralize(kbaCount, "key biodiversity area overlap")} were found in the area checked.`
                  : `The scan found ${pluralize(bioregionCount, "bioregion")} but no protected-area or key biodiversity overlap in the current search area.`}
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-stone-200 bg-white px-4 py-3 text-[12px] leading-relaxed text-stone-600">
            The safest interpretation is cumulative: species records tell you what has been seen nearby, protected areas show where conservation rules may already matter, bioregions explain the landscape, and key biodiversity areas flag especially important places.
          </div>
        </Card>

        <div data-tour="spatial-findings" className="min-h-0 lg:h-[620px]">
          <FindingsPanel
            layerA={layerA}
            loading={loading}
            error={error}
            onRetry={refreshLayerA}
          />
        </div>
      </section>

      <TrustedSourcesSection layerA={layerA} />
        </>
      )}
    </PageShell>
  );
}
