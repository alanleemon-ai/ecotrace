import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Globe2,
  Leaf,
  Map as MapIcon,
  MapPin,
  Newspaper,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Card, Chip, RiskBadge, SectionTitle } from '../components/shared';
import {
  allEvidenceRecords,
  analysisEvidenceCards,
  companyDisplayName,
  companyProfileFromAnalysis,
  confidencePercent,
  loadCompanyAnalysis,
  type BackendCompanyAnalysis,
  type BackendEvidenceRecord,
  type BackendSpatialAnalysis,
} from '../lib/analysis';
import {
  generateReport,
  getSpatialAnalysisForQuery,
  reportHtmlUrl,
  sendPersistedReportEmail,
  queryReportHtmlUrl,
} from '../../lib/api';
import {
  analysisToCompanyWatchlistPayload,
  saveCompanyWatchlistForCurrentUser,
} from '../lib/companyWatchlist';

type Tone = 'stone' | 'emerald' | 'blue' | 'amber' | 'rose' | 'purple' | 'sky';

const toneStyles: Record<Tone, { icon: string; soft: string; bar: string; text: string }> = {
  stone: {
    icon: 'bg-stone-100 text-stone-700',
    soft: 'bg-stone-50 border-stone-200',
    bar: 'bg-stone-500',
    text: 'text-stone-700',
  },
  emerald: {
    icon: 'bg-emerald-50 text-emerald-700',
    soft: 'bg-emerald-50 border-emerald-200',
    bar: 'bg-emerald-500',
    text: 'text-emerald-700',
  },
  blue: {
    icon: 'bg-blue-50 text-blue-700',
    soft: 'bg-blue-50 border-blue-200',
    bar: 'bg-blue-500',
    text: 'text-blue-700',
  },
  amber: {
    icon: 'bg-amber-50 text-amber-700',
    soft: 'bg-amber-50 border-amber-200',
    bar: 'bg-amber-500',
    text: 'text-amber-700',
  },
  rose: {
    icon: 'bg-rose-50 text-rose-700',
    soft: 'bg-rose-50 border-rose-200',
    bar: 'bg-rose-500',
    text: 'text-rose-700',
  },
  purple: {
    icon: 'bg-purple-50 text-purple-700',
    soft: 'bg-purple-50 border-purple-200',
    bar: 'bg-purple-500',
    text: 'text-purple-700',
  },
  sky: {
    icon: 'bg-sky-50 text-sky-700',
    soft: 'bg-sky-50 border-sky-200',
    bar: 'bg-sky-500',
    text: 'text-sky-700',
  },
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number | undefined | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-AU').format(value);
}

function formatDate(value?: string | null) {
  if (!value) return 'Latest analysis';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function numericBreakdownValue(
  spatial: BackendSpatialAnalysis | null | undefined,
  key: string,
): number | null {
  const direct = spatial?.combined_score_breakdown?.[key];
  const components = spatial?.combined_score_breakdown?.components;
  const value = typeof direct === 'number'
    ? direct
    : components && typeof components === 'object' && key in components
      ? (components as Record<string, unknown>)[key]
      : null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return clamp(value);
}

function sourceLabel(value?: string | null) {
  if (!value) return 'Evidence';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function threatCategoryTone(label: string): Tone {
  const code = label.trim().split(/\s+/)[0]?.toUpperCase();
  if (code === 'CR' || code === 'EN') return 'rose';
  if (code === 'VU') return 'amber';
  if (code === 'NT') return 'sky';
  if (code === 'LC') return 'emerald';
  return 'stone';
}

function speciesCountLabel(value: number) {
  const count = Math.round(value);
  return `${formatNumber(count)} species`;
}

function riskDriverTone(value: number): Tone {
  if (value >= 75) return 'rose';
  if (value >= 50) return 'amber';
  if (value >= 25) return 'blue';
  return 'emerald';
}

function sourceMix(analysis: BackendCompanyAnalysis | null, records: BackendEvidenceRecord[]) {
  const counts = new Map<string, number>();
  const add = (label: string, amount = 1) => counts.set(label, (counts.get(label) || 0) + amount);

  records.forEach(record => add(sourceLabel(record.source_type)));
  if (analysis?.news?.candidates?.length || analysis?.news?.candidate_count) {
    add('News candidates', analysis.news.candidates?.length || analysis.news.candidate_count || 0);
  }
  if (analysis?.analysed_reports?.length) add('Uploaded reports', analysis.analysed_reports.length);
  if (analysis?.spatial_analysis?.status === 'success') add('ALA spatial layer', 1);

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function mergeSpatialIntoAnalysis(
  current: BackendCompanyAnalysis | null,
  spatial: BackendSpatialAnalysis,
): BackendCompanyAnalysis | null {
  if (!current) return null;
  if (current.query_id && spatial.query_id && current.query_id !== spatial.query_id) return current;
  return { ...current, spatial_analysis: spatial };
}

function persistCompanyAnalysis(analysis: BackendCompanyAnalysis | null) {
  if (!analysis || typeof window === 'undefined') return;
  window.localStorage.setItem('company_analysis', JSON.stringify(analysis));
}

function SignalBar({
  label,
  value,
  detail,
  tone,
  valueLabel,
  maxValue = 100,
}: {
  label: string;
  value: number;
  detail: string;
  tone: Tone;
  valueLabel?: string;
  maxValue?: number;
}) {
  const width = maxValue > 0 ? clamp((value / maxValue) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] text-stone-900">{label}</div>
        <div className={`text-[12px] tabular-nums ${toneStyles[tone].text}`}>
          {valueLabel ?? `${Math.round(value)}/100`}
        </div>
      </div>
      <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
        <div className={`h-full rounded-full ${toneStyles[tone].bar}`} style={{ width: `${width}%` }} />
      </div>
      <div className="text-[11.5px] leading-relaxed text-stone-500">{detail}</div>
    </div>
  );
}

function OverviewSignalCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneStyles[tone].icon}`}>
          <Icon size={18} />
        </div>
        <div className="text-[24px] font-medium leading-none tabular-nums text-stone-950">{value}</div>
      </div>
      <div className="mt-4 text-[13px] font-medium text-stone-950">{label}</div>
      <div className="mt-1 text-[12px] leading-relaxed text-stone-600">{detail}</div>
    </Card>
  );
}

function TakeawayRow({
  icon: Icon,
  title,
  body,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  tone: Tone;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-stone-200 bg-white p-4">
      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneStyles[tone].icon}`}>
        <Icon size={16} />
      </div>
      <div>
        <div className="text-[13px] font-medium text-stone-950">{title}</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-stone-600">{body}</div>
      </div>
    </div>
  );
}

function EvidencePreview({
  item,
  sourceHref,
  sourceAction,
}: {
  item: ReturnType<typeof analysisEvidenceCards>[number];
  sourceHref: string | null;
  sourceAction: string;
}) {
  const tone = item.conf >= 80 ? 'emerald' : item.conf >= 60 ? 'blue' : 'amber';

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={item.type === 'News' ? 'sky' : item.type === 'Report' ? 'blue' : 'purple'}>{item.type}</Chip>
            {item.evidenceType && <Chip tone="stone">{sourceLabel(item.evidenceType)}</Chip>}
            <Chip tone={tone}>{item.conf}% confidence</Chip>
          </div>
          <div className="mt-2 text-[14px] font-medium leading-snug text-stone-950">{item.title}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-stone-600">
            <span>{formatDate(item.date)}</span>
            <span>{item.source}</span>
            {item.location && <span>{item.location}</span>}
          </div>
        </div>
        {sourceHref ? (
          <a
            href={sourceHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-stone-200 px-2.5 text-[12px] text-stone-700 hover:bg-stone-50"
          >
            <ExternalLink size={12} /> {sourceAction}
          </a>
        ) : (
          <span className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-stone-100 px-2.5 text-[12px] text-stone-400">
            <FileText size={12} /> Source captured
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="min-h-screen bg-[#f5f3ee] p-6 flex items-center justify-center">
      <Card className="max-w-lg p-8 text-center">
        <div className="mx-auto h-14 w-14 rounded-lg bg-stone-100 text-stone-500 flex items-center justify-center">
          <Search size={25} />
        </div>
        <div className="mt-4 text-[20px] text-stone-950">No company analysis selected</div>
        <p className="mt-2 text-[13px] leading-relaxed text-stone-600">
          Run an entity search or evidence analysis first. The investor overview will then combine ABR resolution,
          extracted evidence, and Layer A spatial biodiversity scoring.
        </p>
        <button
          onClick={onSearch}
          className="mt-5 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-4 text-[13px] text-white hover:bg-stone-800"
        >
          <Search size={14} /> Start search
        </button>
      </Card>
    </div>
  );
}

export function CompanyOverview() {
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<BackendCompanyAnalysis | null>(() => loadCompanyAnalysis());
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [spatialBusy, setSpatialBusy] = useState(false);
  const [spatialError, setSpatialError] = useState<string | null>(null);

  const queryId = useMemo(() => {
    if (analysis?.query_id) return analysis.query_id;
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('query_id');
  }, [analysis?.query_id]);

  useEffect(() => {
    if (!queryId) return;

    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    const loadSpatial = async () => {
      try {
        const data = await getSpatialAnalysisForQuery(queryId);
        if (cancelled) return;

        window.localStorage.setItem('latest_spatial_analysis', JSON.stringify(data));
        setAnalysis(current => {
          const merged = mergeSpatialIntoAnalysis(current, data);
          persistCompanyAnalysis(merged);
          return merged;
        });

        if (data.status === 'loading' && attempts < 2) {
          attempts += 1;
          timer = window.setTimeout(loadSpatial, 5000);
        }
      } catch (error) {
        if (!cancelled) {
          setSpatialError(error instanceof Error ? error.message : 'Spatial analysis is unavailable.');
        }
      }
    };

    void loadSpatial();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [queryId]);

  const refreshSpatial = async () => {
    if (!queryId) return;
    setSpatialBusy(true);
    setSpatialError(null);
    try {
      const data = await getSpatialAnalysisForQuery(queryId, true);
      window.localStorage.setItem('latest_spatial_analysis', JSON.stringify(data));
      setAnalysis(current => {
        const merged = mergeSpatialIntoAnalysis(current, data);
        persistCompanyAnalysis(merged);
        return merged;
      });
    } catch (error) {
      setSpatialError(error instanceof Error ? error.message : 'Spatial analysis is unavailable.');
    } finally {
      setSpatialBusy(false);
    }
  };

  const evidenceRecords = useMemo(() => allEvidenceRecords(analysis), [analysis]);
  const evidenceCards = useMemo(() => analysisEvidenceCards(analysis), [analysis]);
  const reportSummaryUrl = analysis?.query_id ? queryReportHtmlUrl(analysis.query_id) : null;
  const profile = useMemo(() => companyProfileFromAnalysis(analysis), [analysis]);
  const companyName = companyDisplayName(analysis);
  const spatial = analysis?.spatial_analysis;
  const hasCombinedNatureScore =
    typeof spatial?.final_score === 'number' || typeof spatial?.combined_biodiversity_score === 'number';
  const scoreSourceLabel = hasCombinedNatureScore ? 'Total biodiversity score' : 'Score pending';
  const score = profile.score;
  const riskLevel = profile.riskLevel;
  const threatCount = spatial?.threatened_species_count ?? 0;
  const assessedSpecies = spatial?.iucn_assessed_species ?? 0;
  const uniqueSpecies = spatial?.unique_species_count ?? 0;
  const alaRecords = spatial?.total_ala_records ?? 0;
  const sourceSummary = sourceMix(analysis, evidenceRecords);
  const avgConfidence = evidenceRecords.length
    ? Math.round(evidenceRecords.reduce((sum, record) => sum + confidencePercent(record), 0) / evidenceRecords.length)
    : profile.confidence;
  const newsCandidates = analysis?.news?.candidates?.length || analysis?.news?.candidate_count || 0;
  const reportEvidence = analysis?.reports?.evidence_count || analysis?.reports?.evidence?.length || 0;
  const riskEvidence = evidenceRecords.filter(record => (record.evidence_type || '').toLowerCase().includes('risk')).length;
  const regulatoryEvidence = evidenceRecords.filter(record => (record.evidence_type || '').toLowerCase().includes('regulatory')).length;
  const actionEvidence = evidenceRecords.filter(record => {
    const type = (record.evidence_type || '').toLowerCase();
    const signal = (record.biodiversity_signal || '').toLowerCase();
    return /action|mitigation|restoration|rehabilitation|offset/.test(`${type} ${signal}`);
  }).length;
  const entityResolved = Boolean(analysis?.resolution?.abr?.success || analysis?.resolution?.abn);
  const speciesThreatScore = typeof spatial?.species_threat_score === 'number'
    ? Math.round(clamp(spatial.species_threat_score))
    : null;
  const protectedAreaExposure = numericBreakdownValue(spatial, 'protected_area_exposure')
    ?? numericBreakdownValue(spatial, 'protected_area_component')
    ?? 0;
  const evidencePressure = numericBreakdownValue(spatial, 'news_regulatory_pressure')
    ?? numericBreakdownValue(spatial, 'evidence_pressure_component')
    ?? 0;
  const ecologicalPriority = numericBreakdownValue(spatial, 'ecological_priority')
    ?? numericBreakdownValue(spatial, 'ecological_priority_component')
    ?? 0;
  const dataGap = numericBreakdownValue(spatial, 'data_gap')
    ?? numericBreakdownValue(spatial, 'data_gap_component')
    ?? 0;
  const noDetectedBiodiversitySignal =
    score === 0 &&
    spatial?.status === 'success' &&
    threatCount === 0 &&
    evidenceRecords.length === 0;

  const drivers = [
    {
      label: 'Protected area exposure',
      value: protectedAreaExposure,
      detail: 'Backend score component from CAPAD protected-area overlap and proximity around the inferred site.',
    },
    {
      label: 'Nearby species sensitivity',
      value: numericBreakdownValue(spatial, 'species_sensitivity') ?? speciesThreatScore ?? 0,
      detail: spatial?.status === 'success'
        ? `${threatCount} threatened species across ${assessedSpecies || uniqueSpecies} assessed species at the inferred site.`
        : spatial?.status === 'loading'
          ? 'Layer A is still resolving ALA and IUCN data for this entity.'
          : 'No completed Layer A result is attached to this company yet.',
    },
    {
      label: 'Extracted evidence pressure',
      value: evidencePressure,
      detail: `${riskEvidence} risk, ${regulatoryEvidence} regulatory, and ${actionEvidence} action/mitigation record${actionEvidence === 1 ? '' : 's'} found in news or uploaded reports.`,
    },
    {
      label: 'Priority ecological context',
      value: ecologicalPriority,
      detail: 'Backend score component from KBA priority places and broader IBRA landscape context.',
    },
    {
      label: 'Data gap',
      value: dataGap,
      detail: `Backend uncertainty component. ${analysis?.analysed_reports?.length ? `${analysis.analysed_reports.length} uploaded report${analysis.analysed_reports.length === 1 ? '' : 's'} checked.` : 'No uploaded company report is attached.'}`,
    },
  ];

  const dueDiligenceQuestions = [
    threatCount > 0
      ? `Which operating assets or suppliers overlap the ${threatCount} threatened species signal?`
      : 'Can management provide verified operating-site biodiversity exposure and species-screening evidence?',
    reportEvidence > 0
      ? 'Do the extracted report claims align with external news and spatial signals?'
      : 'Can the company provide its latest sustainability, nature-risk, or rehabilitation reporting?',
    newsCandidates > 0
      ? 'Which candidate news items require analyst confirmation before committee use?'
      : 'Should a broader regulatory and adverse-media search be run before investment memo sign-off?',
  ];
  const overviewSummary = score >= 70
    ? {
        eyebrow: 'What stands out',
        title: 'This company currently shows a higher biodiversity-risk signal',
        body: `The latest view combines nearby biodiversity exposure with the evidence found in news and company documents. ${threatCount > 0 ? `${threatCount} threatened species were found near the screened location.` : 'No threatened-species count is currently attached.'}`,
      }
    : score >= 45
      ? {
          eyebrow: 'What stands out',
          title: 'This company shows a mixed biodiversity picture',
          body: 'There are enough signals to deserve attention, but the current result still needs the supporting evidence to be read together rather than as a single red flag.',
        }
      : {
          eyebrow: 'What stands out',
          title: noDetectedBiodiversitySignal
            ? 'No biodiversity signal was detected in this scan'
            : 'The current biodiversity signal is lighter',
          body: noDetectedBiodiversitySignal
            ? 'The current sources did not identify nearby threatened species or high-confidence biodiversity evidence. This is a no-signal result, not proof that the company has no biodiversity exposure.'
            : 'The latest review does not show a strong overall pressure signal today, though the company should still be read against the evidence and local nature context below.',
        };

  const signalCards = [
    {
      icon: BarChart3,
      label: 'Total biodiversity score',
      value: `${score}/100`,
      detail: noDetectedBiodiversitySignal
        ? 'No nearby threatened species or high-confidence biodiversity evidence was detected in this scan.'
        : hasCombinedNatureScore
          ? 'Backend-owned score from protected areas, species sensitivity, priority ecology, public evidence, and data gaps.'
          : 'Waiting for the backend scoring engine to finish.',
      tone: score >= 70 ? 'rose' : score >= 45 ? 'amber' : 'emerald',
    },
    {
      icon: Leaf,
      label: 'Threatened wildlife nearby',
      value: spatial?.status === 'success' ? String(threatCount) : 'Pending',
      detail: spatial?.status === 'success'
        ? `${assessedSpecies || uniqueSpecies} checked species had conservation status available.`
        : 'Waiting for the nearby species screen to finish.',
      tone: threatCount >= 10 ? 'rose' : threatCount >= 3 ? 'amber' : 'blue',
    },
    {
      icon: FileCheck2,
      label: 'Evidence records found',
      value: String(evidenceRecords.length),
      detail: `${newsCandidates} news items screened and ${reportEvidence} report-derived signals checked.`,
      tone: evidenceRecords.length ? 'blue' : 'amber',
    },
    {
      icon: ShieldCheck,
      label: 'Evidence confidence',
      value: `${avgConfidence}%`,
      detail: entityResolved
        ? 'The company match is resolved and the extracted evidence can be tied back to a legal entity.'
        : 'The company match still needs checking before relying on the result.',
      tone: entityResolved ? 'emerald' : 'amber',
    },
  ] as const;

  const takeaways = [
    {
      icon: Building2,
      title: entityResolved ? 'The company identity is anchored' : 'The company identity needs review',
      body: entityResolved
        ? `${companyName} is linked to ${analysis?.resolution?.abn ? `ABN ${analysis.resolution.abn}` : 'an ABR entity'}, which helps keep evidence attached to the right business.`
        : 'The company is not fully resolved to a legal entity yet, so the result should be checked before using it for decisions.',
      tone: entityResolved ? 'emerald' : 'amber',
    },
    {
      icon: MapPin,
      title: spatial?.status === 'success' ? 'The local nature context has been checked' : 'The local nature context is still incomplete',
      body: spatial?.status === 'success'
        ? `${formatNumber(alaRecords)} local species records were reviewed around ${spatial?.inferred_location?.label || spatial?.location?.label || 'the inferred site'}, producing a ${speciesThreatScore ?? 'N/A'}/100 nearby species threat score.`
        : spatial?.status === 'loading'
          ? 'The nearby nature scan is running and will sharpen the overview when it finishes.'
          : 'No completed nearby nature scan is attached yet, leaving an important context gap.',
      tone: spatial?.status === 'success' ? 'blue' : 'amber',
    },
    {
      icon: Newspaper,
      title: evidenceRecords.length ? 'Public evidence has been found' : 'Public evidence is still thin',
      body: evidenceRecords.length
        ? `${evidenceRecords.length} evidence record${evidenceRecords.length === 1 ? '' : 's'} were extracted with an average confidence of ${avgConfidence}%.`
        : 'No extracted evidence records are available yet, so recent filings and adverse-media checks would add useful context.',
      tone: evidenceRecords.length ? 'purple' : 'amber',
    },
  ] as const;

  const scoreDrivers = drivers.map(driver => ({
    ...driver,
    tone: riskDriverTone(driver.value),
  }));

  if (!analysis) {
    return <EmptyState onSearch={() => navigate('/app/search')} />;
  }

  return (
    <div className="min-h-screen bg-[#f5f3ee]">
      <div className="max-w-[1380px] mx-auto px-6 py-6 space-y-6">
        <section
          data-tour="overview-summary"
          className="relative overflow-hidden rounded-3xl border border-stone-200 bg-stone-950 shadow-sm"
        >
          <img
            src="/images/company-overview-hero.jpg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-stone-950/95 via-stone-950/82 to-stone-950/30" />
          <div className="relative grid gap-6 p-6 lg:grid-cols-[1fr_360px] lg:p-7">
            <div className="max-w-3xl text-white">
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-100/80">
                Company overview
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <h1 className="text-[30px] leading-tight">{companyName}</h1>
                <RiskBadge level={riskLevel} />
              </div>
              <div className="mt-3 text-[13px] text-stone-200">
                {profile.sector} · ABN {profile.abn} · {profile.state}{profile.postcode ? ` ${profile.postcode}` : ''}
              </div>
              <div className="mt-6">
                <div className="text-[12px] uppercase tracking-[0.18em] text-emerald-100/75">{overviewSummary.eyebrow}</div>
                <div className="mt-2 max-w-2xl text-[24px] leading-tight">{overviewSummary.title}</div>
                <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-stone-200">{overviewSummary.body}</p>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Chip tone={entityResolved ? 'emerald' : 'amber'}>
                  <CheckCircle2 size={11} /> {entityResolved ? 'Company matched' : 'Company match needs review'}
                </Chip>
                <Chip tone={spatial?.status === 'success' ? 'blue' : 'stone'}>
                  <MapPin size={11} /> Nearby nature {spatial?.status || 'pending'}
                </Chip>
                <Chip tone="stone">{evidenceRecords.length} evidence record{evidenceRecords.length === 1 ? '' : 's'}</Chip>
              </div>
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/94 p-5 text-stone-950 backdrop-blur">
              <div className="text-[12px] text-stone-500">{scoreSourceLabel}</div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-[64px] leading-none tabular-nums">{score}</div>
                <div className="pb-2 text-[14px] text-stone-500">/100</div>
              </div>
              <div className="mt-3">
                <RiskBadge level={riskLevel} />
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-200">
                <div
                  className={`h-full ${score >= 70 ? 'bg-rose-500' : score >= 45 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <div className="mt-4 space-y-2 text-[12px] text-stone-600">
                <div className="flex items-center justify-between gap-3">
                  <span>Threatened species nearby</span>
                  <span className="font-medium text-stone-950">{spatial?.status === 'success' ? threatCount : 'Pending'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Evidence confidence</span>
                  <span className="font-medium text-stone-950">{avgConfidence}%</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Last spatial state</span>
                  <span className="font-medium capitalize text-stone-950">{spatial?.status || 'pending'}</span>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={() => navigate('/app/analyse')}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 text-[13px] text-stone-800 hover:bg-stone-50"
                >
                  <FileCheck2 size={14} /> News evidence
                </button>
                <button
                  onClick={() => navigate('/app/spatial')}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 text-[13px] text-stone-800 hover:bg-stone-50"
                >
                  <MapIcon size={14} /> Spatial view
                </button>
              </div>
            </div>
          </div>
          {spatialError && (
            <div className="relative mx-6 mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 lg:mx-7">
              Spatial refresh failed: {spatialError}
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {signalCards.map(card => (
            <OverviewSignalCard key={card.label} {...card} />
          ))}
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card data-tour="overview-investor-read" className="p-6">
            <SectionTitle title="What this means" action={<Chip tone="stone">Plain-language summary</Chip>} />
            <div className="space-y-3">
              {takeaways.map(item => (
                <TakeawayRow key={item.title} {...item} />
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="relative h-56 overflow-hidden">
              <img
                src="/images/company-overview-evidence.jpg"
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-stone-950/25 to-transparent" />
              <div className="absolute bottom-4 left-5 right-5 text-white">
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-100/80">
                  How this view is built
                </div>
                <div className="mt-2 text-[20px] leading-tight">Identity, evidence, and nearby nature</div>
              </div>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-3">
              {[
                ['Company match', entityResolved ? 'Resolved' : 'Review'],
                ['News screened', formatNumber(newsCandidates)],
                ['Source groups', formatNumber(sourceSummary.length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <div className="text-[11px] text-stone-500">{label}</div>
                  <div className="mt-1 text-[18px] text-stone-950">{value}</div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <Card data-tour="overview-risk-drivers" className="p-6">
            <SectionTitle title="What is driving the score" action={<Chip tone="amber">{scoreDrivers.length} signals</Chip>} />
            <div className="space-y-5">
              {scoreDrivers.map(driver => (
                <SignalBar
                  key={driver.label}
                  label={driver.label}
                  value={driver.value}
                  detail={driver.detail}
                  tone={driver.tone}
                />
              ))}
            </div>
          </Card>

          <Card data-tour="overview-spatial-exposure" className="p-6">
            <SectionTitle
              title="Nearby nature"
              action={
                <div className="flex items-center gap-2">
                  <Chip tone={spatial?.status === 'success' ? 'emerald' : spatial?.status === 'loading' ? 'blue' : 'amber'}>
                    {spatial?.status || 'pending'}
                  </Chip>
                  <button
                    onClick={() => void refreshSpatial()}
                    disabled={!queryId || spatialBusy}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Refresh nearby nature"
                  >
                    <RefreshCw size={13} className={spatialBusy ? 'animate-spin' : ''} />
                  </button>
                </div>
              }
            />
            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-xl border border-emerald-100 bg-[#edf7f1] p-4">
                <div className="flex items-center gap-2 text-[13px] text-stone-900">
                  <MapPin size={15} className="text-emerald-700" />
                  {spatial?.inferred_location?.label || spatial?.location?.label || `${profile.state} inferred context`}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    ['Species records', formatNumber(alaRecords)],
                    ['Unique species', formatNumber(uniqueSpecies)],
                    ['Species threat score', speciesThreatScore !== null ? `${speciesThreatScore}/100` : 'N/A'],
                    ['Search radius', `${spatial?.location?.radius_km || spatial?.inferred_location?.radius_km || 10} km`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-white/80 p-3">
                      <div className="text-[11px] text-stone-500">{label}</div>
                      <div className="mt-1 text-[18px] leading-none tabular-nums text-stone-950">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-[11.5px] leading-relaxed text-stone-600">
                  This scan checks biodiversity near the inferred business location, not the company’s full operational footprint.
                </div>
              </div>

              <div>
                <div className="text-[12px] text-stone-500">Threat mix</div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-stone-500">
                  Species counts by IUCN conservation category within the nearby sample.
                </div>
                <div className="mt-3 space-y-2">
                  {Object.entries(spatial?.score_breakdown || {}).length ? (
                    Object.entries(spatial?.score_breakdown || {}).map(([label, value]) => (
                      <SignalBar
                        key={label}
                        label={sourceLabel(label)}
                        value={Math.max(0, Number(value))}
                        valueLabel={speciesCountLabel(Number(value))}
                        maxValue={assessedSpecies || uniqueSpecies || Math.max(1, Number(value))}
                        detail={`${formatNumber(Number(value))} ${Math.round(Number(value)) === 1 ? 'species is' : 'species are'} classified as ${sourceLabel(label)} in this scan.`}
                        tone={threatCategoryTone(label)}
                      />
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-stone-300 p-4 text-[13px] leading-relaxed text-stone-600">
                      The nearby species mix will appear once the spatial analysis has finished.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <Card data-tour="overview-evidence-dossier" className="p-6">
            <SectionTitle title="Evidence found" action={<Chip tone="blue">{evidenceCards.length} records</Chip>} />
            {evidenceCards.length ? (
              <div className="space-y-3">
                {evidenceCards.slice(0, 4).map(item => {
                  const sourceHref = item.url || (item.sourceType === 'report' ? reportSummaryUrl : null);
                  const sourceAction = item.url ? 'Open source' : item.sourceType === 'report' ? 'Open report summary' : 'Source';
                  return (
                    <EvidencePreview
                      key={item.id}
                      item={item}
                      sourceHref={sourceHref}
                      sourceAction={sourceAction}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-300 p-5 text-[13px] leading-relaxed text-stone-600">
                No evidence records are attached yet. Run the news analysis or upload company reports to give this overview more substance.
              </div>
            )}
          </Card>

          <div className="space-y-6">
            <Card className="p-6">
              <SectionTitle title="Questions worth asking next" action={<Sparkles size={16} className="text-amber-600" />} />
              <div className="space-y-3">
                {dueDiligenceQuestions.map((question, index) => (
                  <div key={question} className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-[12px] text-stone-700">
                      {index + 1}
                    </div>
                    <div className="text-[13px] leading-relaxed text-stone-700">{question}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card data-tour="overview-analyst-actions" className="p-6">
              <SectionTitle title="Next steps" action={<Sparkles size={16} className="text-amber-600" />} />
              <div className="space-y-3">
                {[
                  { icon: Star, label: 'Add to watchlist', detail: 'Track changes over time.', action: () => setShowWatchlist(true), tone: 'emerald' as Tone },
                  { icon: Download, label: 'Export summary', detail: 'Create a shareable report.', action: () => setShowExport(true), tone: 'stone' as Tone },
                  { icon: Newspaper, label: 'Read news evidence', detail: 'Review the underlying articles.', action: () => navigate('/app/analyse'), tone: 'blue' as Tone },
                  { icon: Globe2, label: 'Open spatial view', detail: 'Explore the nearby map layers.', action: () => navigate('/app/spatial'), tone: 'amber' as Tone },
                ].map(item => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      onClick={item.action}
                      className="w-full rounded-xl border border-stone-200 bg-white p-3 text-left hover:bg-stone-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${toneStyles[item.tone].icon}`}>
                          <Icon size={16} />
                        </div>
                        <div className="flex-1">
                          <div className="text-[13px] text-stone-950">{item.label}</div>
                          <div className="text-[11.5px] text-stone-500">{item.detail}</div>
                        </div>
                        <ArrowRight size={14} className="text-stone-400" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <Card className="p-6">
            <SectionTitle title="Company details" action={<Chip tone={entityResolved ? 'emerald' : 'amber'}>{analysis.resolution?.abn_status || 'ABR'}</Chip>} />
            <div className="space-y-3 text-[13px]">
              {[
                ['Legal name', analysis.resolution?.legal_name || companyName],
                ['ABN', analysis.resolution?.abn || 'Not available'],
                ['ABN status', analysis.resolution?.abn_status || analysis.resolution?.abr?.abn_status || 'Not available'],
                ['Input type', sourceLabel(analysis.resolution?.input_type)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-b border-stone-100 pb-2 last:border-0">
                  <span className="text-stone-500">{label}</span>
                  <span className="text-right text-stone-950">{value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <SectionTitle title="Source coverage" action={<Chip tone="stone">{sourceSummary.length} groups</Chip>} />
            <div className="grid gap-3 md:grid-cols-2">
              {sourceSummary.length ? sourceSummary.map((source, index) => {
                const tones: Tone[] = ['emerald', 'blue', 'amber', 'rose', 'purple', 'sky'];
                const tone = tones[index % tones.length];
                return (
                  <div key={source.label} className={`rounded-xl border p-4 ${toneStyles[tone].soft}`}>
                    <div className="text-[12px] text-stone-500">{source.label}</div>
                    <div className="mt-1 text-[22px] leading-none text-stone-950 tabular-nums">{source.count}</div>
                  </div>
                );
              }) : (
                <div className="rounded-xl border border-dashed border-stone-300 p-4 text-[13px] text-stone-600">
                  Source mix will appear when evidence, reports, or spatial data are attached.
                </div>
              )}
            </div>
            <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4 text-[12px] leading-relaxed text-stone-600">
              Average extraction confidence is {avgConfidence}%. Use the linked sources before treating any single signal as final investment evidence.
            </div>
          </Card>
        </section>
      </div>

      {showWatchlist && <WatchlistModal companyName={companyName} analysis={analysis} onClose={() => setShowWatchlist(false)} />}
      {showExport && <ExportModal companyName={companyName} queryId={queryId} analysis={analysis} onClose={() => setShowExport(false)} />}
    </div>
  );
}

function WatchlistModal({
  companyName,
  analysis,
  onClose,
}: {
  companyName: string;
  analysis: BackendCompanyAnalysis;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const saveToWatchlist = async () => {
    setStatus('saving');
    setMessage(null);
    try {
      const payload = analysisToCompanyWatchlistPayload(analysis);
      const result = await saveCompanyWatchlistForCurrentUser({
        ...payload,
        notes: notes.trim() || null,
        metadata: payload.metadata,
      });
      setStatus('saved');
      setMessage(
        result.source === 'backend'
          ? 'Company saved to your account watchlist.'
          : 'Company saved to your local watchlist. Connect the database to persist it server-side.',
      );
      window.setTimeout(onClose, 900);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not add company to watchlist.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-100 p-5">
          <div className="flex items-center gap-2 text-[14px] text-stone-950">
            <Star size={16} className="text-emerald-600" /> Save company analysis
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100"
            aria-label="Close watchlist modal"
          >
            <X size={14} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-[13px] leading-relaxed text-stone-600">
            Save <b className="text-stone-950">{companyName}</b> to your company watchlist with this analysis snapshot, then refresh it later from the Watchlist page.
          </p>
          <div>
            <div className="mb-2 text-[11px] uppercase text-stone-500">Notes</div>
            <input
              type="text"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Portfolio holding, supplier review, AGM question..."
              className="h-9 w-full rounded-lg border border-stone-200 px-3 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          {message && (
            <div className={`text-[12px] ${status === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>
              {message}
            </div>
          )}
          <button
            onClick={saveToWatchlist}
            disabled={status === 'saving' || status === 'saved'}
            className="h-10 w-full rounded-lg bg-emerald-700 text-[13px] text-white hover:bg-emerald-800 disabled:bg-stone-300"
          >
            {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved' : 'Save company to watchlist'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportModal({
  companyName,
  queryId,
  analysis,
  onClose,
}: {
  companyName: string;
  queryId: string | null;
  analysis: BackendCompanyAnalysis | null;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState<'idle' | 'generating' | 'sending' | 'sent' | 'error'>('idle');
  const [reportId, setReportId] = useState<string | null>(() => {
    if (typeof window === 'undefined' || !queryId) return null;
    return window.localStorage.getItem(`report_id:${queryId}`);
  });
  const [message, setMessage] = useState<string | null>(null);

  const ensureReport = async () => {
    if (!queryId) {
      setEmailStatus('error');
      setMessage('Run a company search first so Seeco has a query_id to report on.');
      return null;
    }
    if (reportId) return reportId;

    setEmailStatus('generating');
    setMessage('Generating investor report...');
    const generated = await generateReport(queryId, analysis || undefined);
    const nextReportId = generated.report_id;
    setReportId(nextReportId);
    window.localStorage.setItem(`report_id:${queryId}`, nextReportId);
    setEmailStatus('idle');
    setMessage('Report generated and saved.');
    return nextReportId;
  };

  const openReport = async () => {
    try {
      const nextReportId = await ensureReport();
      if (!nextReportId) return;
      window.open(reportHtmlUrl(nextReportId), '_blank', 'noopener,noreferrer');
    } catch (error) {
      setEmailStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not generate report.');
    }
  };

  const saveAsPdf = async () => {
    try {
      const nextReportId = await ensureReport();
      if (!nextReportId) return;
      window.open(reportHtmlUrl(nextReportId, true), '_blank', 'noopener,noreferrer');
      setMessage('Choose Save as PDF in the print dialog.');
    } catch (error) {
      setEmailStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not prepare PDF export.');
    }
  };

  const emailReport = async () => {
    if (!email.trim()) {
      setEmailStatus('error');
      setMessage('Enter an analyst email address.');
      return;
    }
    try {
      const nextReportId = await ensureReport();
      if (!nextReportId) return;
      setEmailStatus('sending');
      setMessage(null);
      const result = await sendPersistedReportEmail(nextReportId, email.trim());
      setEmailStatus('sent');
      setMessage(result.delivery === 'outbox' ? 'Report saved to backend outbox for local delivery.' : `Report emailed to ${result.to}.`);
    } catch (error) {
      setEmailStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not send report email.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-100 p-5">
          <div className="flex items-center gap-2 text-[14px] text-stone-950">
            <Download size={16} className="text-emerald-600" /> Export investor dossier
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100"
            aria-label="Close export modal"
          >
            <X size={14} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-[13px] leading-relaxed text-stone-600">
            Generate a report for <b className="text-stone-950">{companyName}</b> using the current entity, evidence, and spatial analysis payload.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="emerald"><Building2 size={11} /> Entity</Chip>
            <Chip tone="blue"><FileText size={11} /> Evidence</Chip>
            <Chip tone="amber"><MapPin size={11} /> Spatial</Chip>
            <Chip tone="stone"><ClipboardCheck size={11} /> Nature-risk snapshot</Chip>
          </div>
          <div>
            <div className="mb-2 text-[11px] uppercase text-stone-500">Email report</div>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="analyst@firm.com"
                className="h-10 flex-1 rounded-lg border border-stone-200 px-3 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                onClick={emailReport}
                disabled={emailStatus === 'sending'}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-700 px-3 text-[13px] text-white hover:bg-emerald-800 disabled:bg-stone-300"
              >
                {emailStatus === 'sending' ? <RefreshCw size={14} className="animate-spin" /> : 'Send'}
              </button>
            </div>
            {message && (
              <div className={`mt-2 text-[12px] ${emailStatus === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>
                {message}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-10 flex-1 rounded-lg border border-stone-200 text-[13px] text-stone-700 hover:bg-stone-50">
              Cancel
            </button>
            <button onClick={openReport} disabled={emailStatus === 'generating'} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-200 text-[13px] text-stone-700 hover:bg-stone-50 disabled:bg-stone-100">
              <FileText size={13} /> Open
            </button>
            <button onClick={saveAsPdf} disabled={emailStatus === 'generating'} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-stone-950 text-[13px] text-white hover:bg-stone-800 disabled:bg-stone-400">
              <Download size={13} /> PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
