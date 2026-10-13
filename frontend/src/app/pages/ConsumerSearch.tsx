import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ArrowRight,
  Barcode,
  Building2,
  CheckCircle2,
  CircleDot,
  FileText,
  Flame,
  Leaf,
  Loader2,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Card, Chip, Confidence, RiskBadge, ScoreDisclaimer } from '../components/shared';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import {
  allEvidenceRecords,
  companyProfileFromAnalysis,
  riskLevelFromScore,
  type BackendCompanyAnalysis,
  type BackendNewsCandidate,
} from '../lib/analysis';
import {
  ApiError,
  getCompanyAnalysisJob,
  getSpatialAnalysisForQuery,
  resolveCompanyForAnalysis,
  search as searchEntity,
  startCompanyAnalysisJob,
  type SearchResult,
  type SpatialLayerAResponse,
} from '../../lib/api';

const HERO_IMG = 'https://images.unsplash.com/photo-1758702160898-6f96d1db5b73?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1600';

const suggestions = [
  { label: 'Woolworths', abn: '88 000 014 675', sector: 'Retail' },
  { label: 'BHP Group', abn: '49 004 028 077', sector: 'Mining' },
  { label: 'Coles Group', abn: '11 004 089 936', sector: 'Retail' },
  { label: 'Bega Cheese', abn: '81 008 358 503', sector: 'Food & Beverage' },
];

const companyProgressSteps = [
  'Resolving ABN and legal entity',
  'Generating targeted search queries',
  'Searching news evidence',
  'Scanning uploaded reports',
  'Extracting biodiversity evidence',
  'Computing nature risk score',
];
const companyProgressPercents = [12, 28, 45, 62, 78, 92];

const TopoSvg = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 800 400" preserveAspectRatio="none" fill="none">
    {[0, 1, 2, 3, 4, 5, 6].map(i => (
      <path key={i} d={`M0 ${60 + i * 45} Q 200 ${20 + i * 50}, 400 ${80 + i * 40} T 800 ${50 + i * 45}`} stroke="currentColor" strokeWidth="1" opacity={0.18 - i * 0.015} />
    ))}
  </svg>
);

type SearchMode = 'barcode' | 'brand' | 'company';

type CompanyResolutionPreview = {
  legal_name?: string;
  normalized_name?: string;
  abn?: string;
  state?: string;
  postcode?: string;
  abr?: { success?: boolean; message?: string };
};

type ResolvedEntity = {
  brand: string;
  product: string;
  parent: string;
  abn: string;
  score: number | null;
  confidence?: number;
  source?: string;
  imageUrl?: string;
};

type PersistedConsumerSearch = {
  mode: SearchMode;
  value: string;
  queryId: string | null;
  resolutionPreview: CompanyResolutionPreview | null;
  analysis: BackendCompanyAnalysis | null;
  resolved: ResolvedEntity | null;
  spatialAnalysis: SpatialLayerAResponse | null;
};

const CONSUMER_SEARCH_STORAGE_KEY = 'consumer_search_state';
const LATEST_SPATIAL_STORAGE_KEY = 'latest_spatial_analysis';
const ANALYSIS_JOB_STORAGE_KEY = 'company_analysis_job_id';

function readPersistedConsumerSearch(): PersistedConsumerSearch | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(CONSUMER_SEARCH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readLatestSpatialAnalysis(): SpatialLayerAResponse | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(LATEST_SPATIAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistConsumerSearch(state: PersistedConsumerSearch) {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(CONSUMER_SEARCH_STORAGE_KEY, JSON.stringify(state));
}

function clearPersistedAnalysisState() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CONSUMER_SEARCH_STORAGE_KEY);
  window.localStorage.removeItem(LATEST_SPATIAL_STORAGE_KEY);
  window.localStorage.removeItem('company_analysis');
  window.localStorage.removeItem('query_id');
  window.localStorage.removeItem('company_id');
  window.localStorage.removeItem(ANALYSIS_JOB_STORAGE_KEY);
}

function spatialScore(layerA: SpatialLayerAResponse | null | undefined): number | null {
  const score = layerA?.final_score ?? layerA?.combined_biodiversity_score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function hasComputedLandSignals(layerA: SpatialLayerAResponse | null | undefined): boolean {
  return Boolean(
    layerA?.status === 'success' &&
    layerA.nature_signal_counts &&
    typeof layerA.land_signal_score === 'number' &&
    Number.isFinite(layerA.land_signal_score),
  );
}

function hasFinalNatureScore(layerA: SpatialLayerAResponse | null | undefined): boolean {
  return Boolean(
    hasComputedLandSignals(layerA) &&
    layerA?.score_status === 'final' &&
    spatialScore(layerA) !== null,
  );
}

function shouldForceNextSpatialRequest(
  data: SpatialLayerAResponse,
  attempt: number,
  lastForceAttempt: number,
): boolean {
  if (data.status === 'success') {
    return !hasComputedLandSignals(data);
  }
  if (data.status !== 'loading') return false;

  const startedAt = data.started_at ? Date.parse(data.started_at) : Number.NaN;
  const loadingLooksStale = Number.isFinite(startedAt)
    ? Date.now() - startedAt > 15000
    : attempt >= 1;
  return loadingLooksStale && attempt - lastForceAttempt >= 4;
}

function landSignalsFromSpatial(layerA: SpatialLayerAResponse | null | undefined) {
  const summary = layerA?.overlay_summary;
  const counts = layerA?.nature_signal_counts;
  const computed = Boolean(counts);
  const threatenedSpecies = counts?.threatened_species_count ?? 0;
  const threatenedOccurrences = counts?.threatened_occurrence_count ?? 0;
  const protectedAreas = counts?.protected_area_count ?? 0;
  const bioregions = counts?.bioregion_count ?? 0;
  const kbas = counts?.kba_count ?? 0;

  return {
    computed,
    threatenedSpecies,
    threatenedOccurrences,
    protectedAreas,
    bioregions,
    kbas,
    threatenedLabel: computed
      ? threatenedSpecies ? `${threatenedSpecies} threatened species` : 'No threatened species found'
      : 'Threatened species still computing',
    protectedLabel: computed
      ? summary?.protected_area_label || (protectedAreas ? `${protectedAreas} protected area${protectedAreas === 1 ? '' : 's'}` : 'No protected area overlap')
      : 'Protected-area count still computing',
    bioregionLabel: computed
      ? summary?.bioregion_label || (bioregions ? `${bioregions} bioregion${bioregions === 1 ? '' : 's'}` : 'No bioregion context yet')
      : 'Bioregion count still computing',
    kbaLabel: computed
      ? summary?.kba_label || (kbas ? `${kbas} key biodiversity area${kbas === 1 ? '' : 's'}` : 'No key biodiversity overlap')
      : 'KBA count still computing',
  };
}

function mergeAnalysisWithSpatial(
  analysis: BackendCompanyAnalysis | null,
  layerA: SpatialLayerAResponse,
): BackendCompanyAnalysis | null {
  if (!analysis) return null;
  if (analysis.query_id && layerA.query_id && analysis.query_id !== layerA.query_id) return analysis;
  if (
    (typeof analysis.spatial_analysis?.final_score === 'number' ||
      typeof analysis.spatial_analysis?.combined_biodiversity_score === 'number') &&
    typeof layerA.final_score !== 'number' &&
    typeof layerA.combined_biodiversity_score !== 'number'
  ) {
    return analysis;
  }
  return { ...analysis, spatial_analysis: layerA };
}

async function waitForSpatialAnalysis(queryId: string, maxAttempts = 36): Promise<SpatialLayerAResponse | null> {
  let forceNext = false;
  let lastForceAttempt = -10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let data: SpatialLayerAResponse;
    try {
      data = await getSpatialAnalysisForQuery(queryId, forceNext);
    } catch (error) {
      console.debug('Spatial biodiversity score request failed', error);
      return null;
    }
    if (data.status === 'success' && hasComputedLandSignals(data)) return data;
    if (data.status === 'failed') return data;
    forceNext = shouldForceNextSpatialRequest(data, attempt, lastForceAttempt);
    if (forceNext) lastForceAttempt = attempt + 1;
    await new Promise(resolve => window.setTimeout(resolve, 5000));
  }
  return null;
}

async function waitForCompanyAnalysisJob(
  jobId: string,
  onProgress?: (job: any) => void,
  maxAttempts = 720,
): Promise<BackendCompanyAnalysis> {
  let lastJob: any = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let job: any;
    try {
      job = await getCompanyAnalysisJob(jobId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        localStorage.removeItem(ANALYSIS_JOB_STORAGE_KEY);
        throw new Error('Analysis session expired on the server. Please start the analysis again.');
      }
      throw error;
    }
    lastJob = job;
    onProgress?.(job);
    if (job.status === 'completed' && job.result) return job.result as BackendCompanyAnalysis;
    if (job.status === 'failed') throw new Error(job.error || 'Company analysis failed.');
    await new Promise(resolve => window.setTimeout(resolve, 5000));
  }
  throw new Error(lastJob?.error || 'Company analysis is still running. You can return to this page later.');
}

function buildSearchBody(searchMode: SearchMode, searchValue: string) {
  if (searchMode === 'barcode') return { barcode: searchValue, brand: '', company_or_abn: '' };
  if (searchMode === 'brand') return { barcode: '', brand: searchValue, company_or_abn: '' };
  return { barcode: '', brand: '', company_or_abn: searchValue };
}

function searchModeFromParam(value: string | null): SearchMode | null {
  return value === 'barcode' || value === 'brand' || value === 'company' ? value : null;
}

function ownedCompanyAnalysisTarget(result: SearchResult): string | null {
  return (
    result.company?.abn ||
    result.abn_verification?.abn ||
    result.company?.legal_name ||
    result.abn_verification?.legal_name ||
    result.legal_owner ||
    result.brand_owner ||
    result.manufacturer ||
    null
  );
}

function resolutionPreviewFromSearchResult(result: SearchResult, fallback: string): CompanyResolutionPreview {
  return {
    legal_name: result.company?.legal_name || result.abn_verification?.legal_name || result.legal_owner || result.brand_owner || fallback,
    normalized_name: result.abn_verification?.legal_name || result.company?.legal_name || result.legal_owner || result.brand_clean || fallback,
    abn: result.company?.abn || result.abn_verification?.abn,
    state: result.company?.state || result.abn_verification?.state,
    postcode: result.company?.postcode || result.abn_verification?.postcode,
    abr: {
      success: Boolean(result.company?.abn || result.abn_verification?.success),
      message: result.message,
    },
  };
}

function resolvedEntityFromSearchResult(result: SearchResult, fallback: string): ResolvedEntity {
  return {
    brand: result.brand?.brand_name || result.brand_clean || result.brand_owner || result.brand_raw || result.input_value || fallback,
    product: result.product?.product_name || result.company?.legal_name || result.brand?.brand_name || result.input_value || 'Unknown product',
    parent: result.company?.legal_name || result.legal_owner || result.manufacturer || result.abn_verification?.legal_name || result.brand_owner || 'Unknown company',
    abn: result.company?.abn || result.abn_verification?.abn || 'N/A',
    score: null,
    confidence: result.confidence || 50,
    source: result.source,
    imageUrl: result.product?.image_url,
  };
}

function evidenceReason(record: ReturnType<typeof allEvidenceRecords>[number]) {
  const signal = record.biodiversity_signal || record.evidence_type || 'Biodiversity evidence';
  const location = record.location ? ` in ${record.location}` : '';
  const source = record.source ? ` Source: ${record.source}.` : '';
  const type = record.evidence_type ? ` (${record.evidence_type})` : '';
  return `${signal}${location}${type}.${source}`.replace(/\s+/g, ' ').trim();
}

export function ConsumerSearch() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const companyParam = searchParams.get('company')?.trim() || '';
  const modeParam = searchModeFromParam(searchParams.get('mode'));
  const shouldAutorunParam = searchParams.get('autorun') === '1';
  const initialSearch = useRef(companyParam || modeParam ? null : readPersistedConsumerSearch()).current;
  const autorunStarted = useRef(false);
  const initialSpatial = useRef<SpatialLayerAResponse | null>((() => {
    if (modeParam) return null;
    const latest = initialSearch?.spatialAnalysis || readLatestSpatialAnalysis();
    if (!latest) return null;
    if (initialSearch?.queryId && latest.query_id && latest.query_id !== initialSearch.queryId) return null;
    return latest;
  })()).current;
  const [mode, setMode] = useState<SearchMode>(companyParam ? 'company' : modeParam || initialSearch?.mode || 'company');
  const [value, setValue] = useState(companyParam || initialSearch?.value || '');
  const [reportFiles, setReportFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [queryId, setQueryId] = useState<string | null>(() => initialSearch?.queryId || (modeParam ? null : localStorage.getItem('query_id')));
  const [resolutionPreview, setResolutionPreview] = useState<CompanyResolutionPreview | null>(initialSearch?.resolutionPreview || null);
  const [analysis, setAnalysis] = useState<BackendCompanyAnalysis | null>(initialSearch?.analysis || null);
  const [resolved, setResolved] = useState<ResolvedEntity | null>(initialSearch?.resolved || null);
  const [spatialAnalysis, setSpatialAnalysis] = useState<SpatialLayerAResponse | null>(initialSpatial || null);
  const [error, setError] = useState<string | null>(null);
  const [spatialError, setSpatialError] = useState<string | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  const evidenceRecords = allEvidenceRecords(analysis);
  const newsCandidates: BackendNewsCandidate[] = analysis?.news?.candidates || [];
  const hasUploadedReports = analysis
    ? Boolean(analysis.analysed_reports?.length)
    : reportFiles.length > 0;
  const skippedReports = analysis?.skipped_reports || [];
  const canShowSpatialAnalysis = Boolean(queryId);
  const awaitingInlineSpatial = isLoading && progressStep >= 5;
  const effectiveSpatialAnalysis = canShowSpatialAnalysis
    ? spatialAnalysis || analysis?.spatial_analysis
    : null;
  const assessedSpatialScore = spatialScore(effectiveSpatialAnalysis);
  const landSignals = landSignalsFromSpatial(effectiveSpatialAnalysis);
  const scoreStatus = effectiveSpatialAnalysis?.score_status || null;
  const scoreIsFinal = scoreStatus === 'final';
  const scoreDrivers = effectiveSpatialAnalysis?.score_drivers || [];
  const speciesComponentScore = effectiveSpatialAnalysis?.species_score ?? effectiveSpatialAnalysis?.species_threat_score ?? 0;
  const landSignalComponentScore = effectiveSpatialAnalysis?.land_signal_score ?? 0;
  const scoreReady = hasFinalNatureScore(effectiveSpatialAnalysis);
  const finalBiodiversityScore = scoreReady
    ? assessedSpatialScore
    : null;
  const noDetectedBiodiversitySignal =
    finalBiodiversityScore === 0 &&
    landSignals.threatenedSpecies === 0 &&
    landSignals.protectedAreas === 0 &&
    landSignals.kbas === 0 &&
    evidenceRecords.length === 0;
  const resolvedConfidence = resolved?.confidence
    ?? (analysis ? companyProfileFromAnalysis(analysis).confidence : resolutionPreview?.abr?.success ? 70 : 45);
  const analysisProgressPercent = companyProgressPercents[Math.min(progressStep, companyProgressPercents.length - 1)];

  const evidenceScoreReasons = analysis
    ? evidenceRecords.length
      ? [
          ...evidenceRecords.slice(0, 2).map(evidenceReason),
          newsCandidates.length
            ? `News reviewed: ${newsCandidates.slice(0, 2).map(candidate => candidate.title || candidate.source || 'candidate article').join('; ')}.`
            : `${evidenceRecords.length} extracted evidence record${evidenceRecords.length === 1 ? '' : 's'} found.`,
        ].slice(0, 3)
      : [
          'ABR resolution completed for the legal entity.',
          analysis.analysed_reports?.length
            ? 'Uploaded reports were checked, but no high-confidence biodiversity evidence was extracted.'
            : skippedReports.length
              ? 'Uploaded reports were skipped because they did not match the selected company.'
              : 'No report was uploaded, so report evidence was not analysed.',
          newsCandidates.length
            ? `News candidate reviewed: ${newsCandidates[0]?.title || newsCandidates[0]?.source || 'candidate article'}.`
            : analysis.news?.candidate_count
              ? `${analysis.news.candidate_count} news candidate${analysis.news.candidate_count === 1 ? '' : 's'} found for review.`
              : 'No high-confidence news evidence was returned by the configured sources.',
        ]
    : [
        'Company identity is resolved first through ABR.',
        'News evidence will appear here after analysis completes.',
        'Upload a company report to include document-based evidence.',
      ];
  const scoreReasons = assessedSpatialScore !== null && scoreReady
    ? noDetectedBiodiversitySignal
      ? [
          'No material nature-risk signal was detected in this scan: no nearby threatened species, protected-area/KBA overlap, or high-confidence extracted evidence.',
          'This is a no-signal result from the current sources, not proof that the company has no biodiversity exposure.',
          hasUploadedReports
            ? 'Uploaded reports were checked alongside public news.'
            : 'Upload a company sustainability or annual report to improve disclosure coverage.',
        ]
      : [
          effectiveSpatialAnalysis?.score_summary ||
            `${scoreIsFinal ? 'Final' : 'Partial spatial'} nature risk score is ${assessedSpatialScore}/100, using threatened species, protected areas, key biodiversity areas, bioregions, and evidence pressure.`,
          `${landSignals.threatenedLabel}; ${landSignals.protectedLabel}; ${landSignals.kbaLabel}; ${landSignals.bioregionLabel}.`,
          ...evidenceScoreReasons,
        ].slice(0, 4)
    : [
        'The nature risk score appears after the backend combines spatial land signals, threatened species, evidence pressure, and confidence.',
        ...evidenceScoreReasons,
      ].slice(0, 3);
  const completedChecks = [
    {
      icon: Building2,
      label: 'Company identity',
      value: analysis?.resolution?.abr?.success ? 'Confirmed' : 'Needs review',
      detail: analysis?.resolution?.abr?.success
        ? 'Matched to an Australian Business Registry entity.'
        : 'The legal company match should be reviewed before relying on the result.',
      tone: analysis?.resolution?.abr?.success ? 'emerald' : 'amber',
      done: Boolean(analysis?.resolution?.abr?.success),
    },
    {
      icon: Search,
      label: 'Public news',
      value: `${newsCandidates.length || analysis?.news?.candidate_count || 0} reviewed`,
      detail: 'Relevant articles were searched for biodiversity-related signals.',
      tone: newsCandidates.length || analysis?.news?.candidate_count ? 'blue' : 'stone',
      done: true,
    },
    {
      icon: FileText,
      label: 'Company reports',
      value: hasUploadedReports
        ? `${analysis?.analysed_reports?.length || analysis?.uploaded_reports?.length || 0} checked`
        : 'None uploaded',
      detail: hasUploadedReports
        ? 'Uploaded documents were checked for company-specific evidence.'
        : 'No annual or sustainability report was included in this run.',
      tone: hasUploadedReports ? 'purple' : 'stone',
      done: hasUploadedReports,
    },
    {
      icon: Leaf,
      label: 'Nearby nature',
      value: scoreReady ? 'Checked' : 'Pending',
      detail: scoreReady
        ? `${landSignals.threatenedSpecies} threatened species, ${landSignals.protectedAreas} protected area${landSignals.protectedAreas === 1 ? '' : 's'}, ${landSignals.kbas} key biodiversity area${landSignals.kbas === 1 ? '' : 's'}, and ${landSignals.bioregions} bioregion${landSignals.bioregions === 1 ? '' : 's'} included.`
        : 'Land signals are computed from the resolved company location before they are shown.',
      tone: scoreReady ? 'emerald' : 'amber',
      done: scoreReady,
    },
  ] as const;
  const reviewTakeaway = evidenceRecords.length > 0
    ? {
        title: `${evidenceRecords.length} biodiversity signal${evidenceRecords.length === 1 ? '' : 's'} found`,
        body: 'These findings are the main reasons to read the evidence cards below and compare them with the nature risk score.',
        tone: 'emerald',
      }
    : newsCandidates.length || analysis?.news?.candidate_count
      ? {
          title: 'Coverage was checked, but no strong signal was extracted',
          body: 'That can be a valid low-signal result. It means the reviewed material did not produce a clear biodiversity finding, not that the company has no nature exposure.',
          tone: 'amber',
        }
      : {
          title: 'No relevant public coverage was found in this run',
          body: 'This is a lighter evidence result. A broader search or a company report can add more confidence before drawing conclusions.',
          tone: 'stone',
        };

  useEffect(() => {
    if (!resolved) return;

    persistConsumerSearch({
      mode,
      value,
      queryId,
      resolutionPreview,
      analysis,
      resolved,
      spatialAnalysis,
    });
  }, [analysis, mode, queryId, resolutionPreview, resolved, spatialAnalysis, value]);

  useEffect(() => {
    if (!queryId) return;
    if (isLoading) return;
    if (!canShowSpatialAnalysis) {
      setSpatialAnalysis(null);
      return;
    }

    let cancelled = false;
    let poll: number | undefined;
    let forceNextSpatialLoad = false;
    let pollAttempts = 0;
    let lastForcePollAttempt = -10;
    const maxPollAttempts = 36;

    const loadSpatialScore = () => {
      pollAttempts += 1;
      setSpatialError(null);
      getSpatialAnalysisForQuery(queryId, forceNextSpatialLoad)
        .then((data) => {
          if (cancelled) return;

          setSpatialAnalysis(data);

          const score = spatialScore(data);
          const hasLandSignals = hasComputedLandSignals(data);
          const hasFinalScore = hasFinalNatureScore(data);
          if (data.status === 'success' && hasLandSignals) {
            window.localStorage.setItem(LATEST_SPATIAL_STORAGE_KEY, JSON.stringify(data));
            if (score !== null && hasFinalScore) {
              setResolved((current) => current ? { ...current, score } : current);
            }
            setAnalysis((current) => {
              const next = mergeAnalysisWithSpatial(current, data);
              if (next) {
                window.localStorage.setItem('company_analysis', JSON.stringify(next));
              }
              return next;
            });
          }

          if (
            pollAttempts < maxPollAttempts &&
            (data.status === 'loading' || (data.status === 'success' && !hasFinalScore))
          ) {
            forceNextSpatialLoad = shouldForceNextSpatialRequest(
              data,
              pollAttempts - 1,
              lastForcePollAttempt,
            );
            if (forceNextSpatialLoad) lastForcePollAttempt = pollAttempts;
            poll = window.setTimeout(loadSpatialScore, 5000);
          }
        })
        .catch((err) => {
          console.debug('Spatial biodiversity score request failed', err);
          if (!cancelled) {
            setSpatialError(err instanceof Error ? err.message : 'Spatial score could not be loaded.');
          }
        });
    };

    loadSpatialScore();

    return () => {
      cancelled = true;
      if (poll) window.clearTimeout(poll);
    };
  }, [canShowSpatialAnalysis, isLoading, queryId]);

  useEffect(() => {
    const jobId = localStorage.getItem(ANALYSIS_JOB_STORAGE_KEY);
    if (!jobId || analysis) return;

    let cancelled = false;
    setIsLoading(true);
    setProgressStep(2);
    waitForCompanyAnalysisJob(jobId, (job) => {
      if (cancelled) return;
      const progress = typeof job.progress === 'number' ? job.progress : 10;
      if (progress >= 90) setProgressStep(5);
      else if (progress >= 40) setProgressStep(4);
      else setProgressStep(2);
    })
      .then(async (data) => {
        if (cancelled) return;
        localStorage.removeItem(ANALYSIS_JOB_STORAGE_KEY);
        if (data.query_id) {
          localStorage.setItem('query_id', data.query_id);
          setQueryId(data.query_id);
        }
        const spatial = data.query_id && !data.database_error ? await waitForSpatialAnalysis(data.query_id) : null;
        const analysisWithSpatial = hasComputedLandSignals(spatial)
          ? mergeAnalysisWithSpatial(data, spatial) || data
          : data;
        localStorage.setItem('company_analysis', JSON.stringify(analysisWithSpatial));
        setAnalysis(analysisWithSpatial);
        const profile = companyProfileFromAnalysis(analysisWithSpatial);
        setResolved({
          brand: data.resolution?.normalized_name || data.resolution?.input_value || value || 'Company',
          product: data.resolution?.legal_name || data.resolution?.normalized_name || value || 'Company',
          parent: data.resolution?.legal_name || 'Unknown company',
          abn: data.resolution?.abn || 'N/A',
          score: hasFinalNatureScore(spatial) ? spatialScore(spatial) : null,
          confidence: profile.confidence,
          source: 'ABR + Mediastack + LLM analysis',
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Company analysis failed.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [analysis, value]);

  const scrollToResults = () => {
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const resolveCompany = async (searchValue: string) => {
    const resolveForm = new FormData();
    resolveForm.append('company_or_abn', searchValue);
    const resolveData = await resolveCompanyForAnalysis(resolveForm);

    const preview = resolveData.resolution || {};
    if (resolveData.query_id) {
      localStorage.setItem('query_id', resolveData.query_id);
      setQueryId(resolveData.query_id);
    }
    if (resolveData.resolved_company_id) {
      localStorage.setItem('company_id', resolveData.resolved_company_id);
    }
    setResolutionPreview(preview);
    setProgressStep(1);
    setResolved({
      brand: preview.normalized_name || searchValue,
      product: preview.legal_name || preview.normalized_name || searchValue,
      parent: preview.legal_name || 'Unknown company',
      abn: preview.abn || 'N/A',
      score: null,
      confidence: preview.abr?.success ? 70 : 45,
      source: 'ABR company resolution',
    });
    scrollToResults();
  };

  const analyseCompany = async (searchValue: string, displayResolved?: Partial<ResolvedEntity>) => {
    const formData = new FormData();
    formData.append('company_or_abn', searchValue);
    formData.append('news_limit', '3');
    formData.append('max_llm_results', '5');
    formData.append('max_report_chunks', '3');
    formData.append('australia_only', 'true');
    reportFiles.forEach(file => formData.append('reports', file));

    setProgressStep(reportFiles.length ? 3 : 2);
    const job = await startCompanyAnalysisJob(formData);
    if (job.job_id) {
      localStorage.setItem(ANALYSIS_JOB_STORAGE_KEY, job.job_id);
    }
    const data = await waitForCompanyAnalysisJob(job.job_id, (nextJob) => {
      const progress = typeof nextJob.progress === 'number' ? nextJob.progress : 10;
      if (progress >= 90) setProgressStep(5);
      else if (progress >= 40) setProgressStep(4);
      else setProgressStep(reportFiles.length ? 3 : 2);
    });
    localStorage.removeItem(ANALYSIS_JOB_STORAGE_KEY);

    if (data.query_id) {
      localStorage.setItem('query_id', data.query_id);
      setQueryId(data.query_id);
    }
    if (data.resolved_company_id) {
      localStorage.setItem('company_id', data.resolved_company_id);
    }
    setProgressStep(4);
    setProgressStep(5);

    const spatial = data.query_id && !data.database_error ? await waitForSpatialAnalysis(data.query_id) : null;
    const analysisWithSpatial = hasComputedLandSignals(spatial)
      ? mergeAnalysisWithSpatial(data, spatial) || data
      : data;
    if (spatial) {
      setSpatialAnalysis(spatial);
      if (hasComputedLandSignals(spatial)) {
        window.localStorage.setItem(LATEST_SPATIAL_STORAGE_KEY, JSON.stringify(spatial));
      }
    }
    localStorage.setItem('company_analysis', JSON.stringify(analysisWithSpatial));
    setAnalysis(analysisWithSpatial);

    const profile = companyProfileFromAnalysis(analysisWithSpatial);
    const resolution = data.resolution || {};
    setResolved({
      brand: displayResolved?.brand || resolution.normalized_name || searchValue,
      product: displayResolved?.product || resolution.legal_name || resolution.normalized_name || searchValue,
      parent: resolution.legal_name || displayResolved?.parent || 'Unknown company',
      abn: resolution.abn || displayResolved?.abn || 'N/A',
      score: hasFinalNatureScore(spatial) ? spatialScore(spatial) : null,
      confidence: profile.confidence,
      source: displayResolved?.source || (reportFiles.length ? 'ABR + news APIs + uploaded reports' : 'ABR + news APIs'),
      imageUrl: displayResolved?.imageUrl,
    });
    scrollToResults();
  };

  const resolveGenericSearch = async (searchMode: SearchMode, searchValue: string) => {
    const data = await searchEntity(buildSearchBody(searchMode, searchValue));
    if (!data.query_id) {
      throw new Error('Search completed, but no query_id was returned.');
    }

    localStorage.setItem('query_id', data.query_id);
    setQueryId(data.query_id);
    if (data.resolved_ids?.company_id) {
      localStorage.setItem('company_id', data.resolved_ids.company_id);
    }
    const result = data.result;
    if (!result) {
      throw new Error('No matching result found.');
    }

    const resolvedEntity = resolvedEntityFromSearchResult(result, searchValue);
    setResolved(resolvedEntity);
    setResolutionPreview(resolutionPreviewFromSearchResult(result, searchValue));
    scrollToResults();

    const ownerTarget = ownedCompanyAnalysisTarget(result);
    if (ownerTarget) {
      setProgressStep(1);
      await analyseCompany(ownerTarget, {
        ...resolvedEntity,
        source: `${result.source || 'Entity resolution'} + owner company analysis`,
      });
    }
  };

  const resolveWithValue = async (searchMode: SearchMode, rawValue: string) => {
    const searchValue = rawValue.trim();
    setError(null);

    if (!searchValue) {
      setError('Please enter a barcode, brand, company name, or ABN.');
      return;
    }

    try {
      setIsLoading(true);
      setProgressStep(0);
      clearPersistedAnalysisState();
      setQueryId(null);
      setAnalysis(null);
      setResolutionPreview(null);
      setSpatialAnalysis(null);
      setSpatialError(null);
      setResolved(null);

      if (searchMode === 'company') {
        await resolveCompany(searchValue);
        await analyseCompany(searchValue);
      } else {
        await resolveGenericSearch(searchMode, searchValue);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Error connecting to backend. Please check the server is running.');
    } finally {
      setProgressStep(0);
      setIsLoading(false);
    }
  };

  const resolve = () => resolveWithValue(mode, value);

  useEffect(() => {
    if (!companyParam || !shouldAutorunParam || autorunStarted.current) return;
    autorunStarted.current = true;
    setMode('company');
    setValue(companyParam);
    void resolveWithValue('company', companyParam);
  }, [companyParam, shouldAutorunParam]);

  useEffect(() => {
    if (companyParam || !modeParam) return;
    setMode(modeParam);
    setValue('');
    setError(null);
  }, [companyParam, modeParam]);

  return (
    <div className="-m-0 bg-gradient-to-b from-[#f5f3ee] via-[#eef1ec] to-[#e3ebe4] min-h-[calc(100vh-65px)]">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <ImageWithFallback src={HERO_IMG} alt="forest canopy" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-stone-950/80 via-stone-900/70 to-[#f5f3ee]" />
          <div className="absolute inset-0 opacity-25">
            <svg className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <pattern id="searchGrid" width="60" height="60" patternUnits="userSpaceOnUse">
                  <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#d6d3d1" strokeWidth="0.4" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#searchGrid)" />
            </svg>
          </div>
        </div>

        <div className="relative z-10 max-w-4xl mx-auto px-8 pt-16 pb-20">
          <div className="flex items-center gap-3 mb-5 text-emerald-200/80 font-mono text-[11px] tracking-[0.2em]">
            <span className="w-8 h-px bg-emerald-300/60" />
            <span>01 - RESOLVE & SCORE</span>
          </div>

          <h1 className="text-[40px] md:text-[52px] leading-[1.05] tracking-tight text-white max-w-2xl">
            Start with a product, brand, company, or ABN
            <span className="block italic text-emerald-200 font-light">and build a traceable nature-risk readout.</span>
          </h1>

          <p className="mt-5 text-stone-200/85 text-[15px] max-w-xl leading-relaxed">
            Seeco resolves the legal entity, checks public and uploaded evidence, and estimates nearby biodiversity exposure from current data sources.
          </p>

          <div className="mt-9 bg-white rounded-2xl shadow-2xl p-1.5 border border-white/10">
            <div data-tour="search-modes" className="flex gap-1 p-1 bg-stone-50 rounded-xl">
              {([
                { id: 'barcode', label: 'Barcode', icon: Barcode },
                { id: 'brand', label: 'Brand', icon: Sparkles },
                { id: 'company', label: 'Company / ABN', icon: Building2 },
              ] as const).map(t => {
                const Icon = t.icon;
                const active = mode === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setMode(t.id); setValue(''); setError(null); }}
                    className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[13px] tracking-tight transition ${
                      active ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-900'
                    }`}
                  >
                    <Icon size={14} /> {t.label}
                  </button>
                );
              })}
            </div>

            <div data-tour="search-entry" className="flex items-center gap-2 p-2">
              <Search size={16} className="text-stone-400 ml-2" />
              <input
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isLoading && resolve()}
                placeholder={mode === 'barcode' ? '9 310072 011691' : mode === 'brand' ? 'e.g. Dairy Farmers, Tim Tam' : 'Company name or ABN'}
                className="flex-1 h-11 bg-transparent outline-none text-[14px] text-stone-800 placeholder:text-stone-400"
              />
              <button
                onClick={resolve}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-5 h-10 bg-emerald-500 hover:bg-emerald-400 disabled:bg-stone-300 disabled:text-stone-600 text-stone-950 rounded-lg text-[13px] shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)]"
              >
                {isLoading ? <><Loader2 size={14} className="animate-spin" /> Analysing</> : <>Analyse <ArrowRight size={14} /></>}
              </button>
            </div>

            {error && (
              <div className="mx-2 mb-1 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-[12px] text-rose-700">
                {error}
              </div>
            )}

            <div data-tour="report-upload" className="mx-2 mb-2 p-3 rounded-xl bg-stone-50 border border-dashed border-stone-200 group hover:bg-stone-100 hover:border-stone-300 transition-colors cursor-pointer text-center relative">
              <input
                type="file"
                accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm"
                multiple
                onChange={event => setReportFiles(Array.from(event.target.files || []))}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <div className="flex flex-col items-center justify-center gap-1.5 pointer-events-none">
                <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
                  <FileText size={14} />
                </div>
                <div className="text-[12px] font-medium text-stone-700">
                  {reportFiles.length ? `${reportFiles.length} report${reportFiles.length === 1 ? '' : 's'} selected` : 'Upload annual or sustainability reports'}
                </div>
                <div className="text-[10px] text-stone-400">PDF, text, HTML, CSV or JSON. Reports are analysed with company search.</div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-white/15 flex flex-wrap items-center gap-x-8 gap-y-2 text-white/80">
            <div className="font-mono text-[10px] tracking-[0.2em] text-white/50">DATA INPUTS</div>
            {['ABR', 'IP Australia', 'OpenFoodFacts', 'News APIs', 'IUCN', 'ALA'].map(s => (
              <span key={s} className="text-[11px] tracking-tight">{s}</span>
            ))}
          </div>
        </div>
      </section>

      <section data-tour="search-results" className="max-w-5xl mx-auto px-8 py-14">
        {isLoading && (
          <Card className="p-5 mb-6 border-emerald-100">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-700">Analysis running</div>
                <div className="text-[17px] text-stone-900 mt-1">
                  {resolutionPreview?.legal_name || resolutionPreview?.normalized_name || value || 'Resolving company'}
                </div>
                <div className="text-[12px] text-stone-500 mt-1">
                  {resolutionPreview?.abn ? `ABN ${resolutionPreview.abn}` : 'Checking ABR first, then evidence sources'}
                  {resolutionPreview?.state ? ` - ${resolutionPreview.state}` : ''}
                </div>
              </div>
              <Chip tone={resolutionPreview?.abr?.success ? 'emerald' : 'amber'}>
                {resolutionPreview ? 'Company resolved' : 'Resolving company'}
              </Chip>
            </div>

            {awaitingInlineSpatial && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                Waiting for the backend nature-risk score before showing the final result.
              </div>
            )}

            <div className="mt-4">
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="font-mono uppercase tracking-[0.18em] text-stone-500">Overall progress</span>
                <span className="font-mono tabular-nums text-emerald-700">{analysisProgressPercent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-amber-400 transition-[width] duration-500 ease-out"
                  style={{ width: `${analysisProgressPercent}%` }}
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-6 gap-2">
              {companyProgressSteps.map((step, index) => {
                const done = index < progressStep;
                const active = index === progressStep;
                return (
                  <div
                    key={step}
                    className={`min-h-16 rounded-xl border px-3 py-2 text-[11px] transition ${
                      done
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : active
                          ? 'bg-white border-emerald-300 text-stone-900 shadow-sm'
                          : 'bg-stone-50 border-stone-100 text-stone-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${done ? 'bg-emerald-500' : active ? 'bg-amber-500 animate-pulse' : 'bg-stone-300'}`} />
                      <span className="font-mono text-[9px] tracking-[0.16em]">0{index + 1}</span>
                    </div>
                    <div className="mt-1 leading-snug">{step}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {!resolved && (
          <div className="space-y-10">
            <div>
              <div className="flex items-end justify-between mb-5">
                <div>
                  <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-emerald-700 font-mono mb-1">
                    <Flame size={12} /> 02 - TRENDING
                  </div>
                  <h2 className="text-[22px] tracking-tight text-stone-900">What Australians are searching</h2>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {suggestions.map((s, i) => (
                    <button
                      key={s.label}
                      onClick={() => {
                        setMode('company');
                        setValue(s.abn);
                        resolveWithValue('company', s.abn);
                      }}
                      className="group relative p-5 bg-white border border-stone-200 hover:border-emerald-400 hover:shadow-md rounded-2xl text-left transition"
                    >
                      <div className="font-mono text-[9px] tracking-[0.2em] text-stone-400 mb-3">0{i + 1} / 04</div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-700">Run analysis</div>
                      <div className="mt-3 text-[14px] text-stone-900 truncate">{s.label}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5">{s.sector}</div>
                      <div className="mt-4 pt-3 border-t border-dashed border-stone-200 flex items-center justify-between">
                        <span className="text-[10px] text-stone-400 font-mono">ABN {s.abn.slice(0, 8)}...</span>
                        <ArrowRight size={12} className="text-stone-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition" />
                      </div>
                    </button>
                ))}
              </div>
            </div>

            <div className="relative grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { icon: ShieldCheck, title: 'Entity resolution', text: 'Searches are linked to an ABR company record where the available data supports it.' },
                { icon: MapPin, title: 'Evidence-first', text: 'Reports and news are separated so unrelated local files are not reused.' },
                { icon: Leaf, title: 'Plain English', text: 'We explain the score from protected land, species, evidence, and data confidence.' },
              ].map((f, i) => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className="relative p-6 bg-white border border-stone-200 rounded-2xl overflow-hidden">
                    <TopoSvg className="absolute inset-0 w-full h-full text-emerald-800 pointer-events-none" />
                    <div className="relative">
                      <div className="font-mono text-[10px] tracking-[0.2em] text-stone-400 mb-3">0{i + 1} - {f.title.toUpperCase().split(' ')[0]}</div>
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-3"><Icon size={18} /></div>
                      <div className="text-[15px] text-stone-900 tracking-tight">{f.title}</div>
                      <div className="text-[12px] text-stone-600 mt-1.5 leading-relaxed">{f.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {resolved && (
          <div ref={resultsRef} className="space-y-6 scroll-mt-24">
            <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-emerald-700 font-mono">
              <CheckCircle2 size={12} /> 02 - RESOLVED
            </div>

            <Card className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-100 to-blue-100 flex items-center justify-center">
                  <Leaf size={24} className="text-emerald-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">Resolved entity</div>
                    <Chip tone="emerald"><CheckCircle2 size={11} /> ABR verified</Chip>
                  </div>
                  <div className="text-[18px] text-stone-900 mt-0.5 tracking-tight">{resolved.product}</div>
                  {resolved.imageUrl && (
                    <img src={resolved.imageUrl} alt={resolved.product} className="mt-3 w-24 h-24 object-cover rounded-xl border border-stone-200" />
                  )}
                  <div className="text-[13px] text-stone-600">
                    Brand <span className="text-stone-900">{resolved.brand}</span> - Owned by <span className="text-stone-900">{resolved.parent}</span> - ABN {resolved.abn}
                  </div>
                  {analysis && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip tone="stone">{analysis.search_queries?.length || 0} generated queries</Chip>
                      <Chip tone="stone">{analysis.news?.candidate_count || newsCandidates.length || 0} news candidates</Chip>
                      {hasUploadedReports && (
                        <Chip tone="blue">
                          {analysis.analysed_reports?.length || analysis.uploaded_reports?.length || 0} uploaded reports checked
                        </Chip>
                      )}
                    </div>
                  )}
                  <div className="mt-2">
                    <Confidence value={Math.min(100, Math.max(0, resolvedConfidence))} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => navigate('/app/spatial')} className="inline-flex items-center gap-1.5 px-3.5 h-9 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm">
                    Spatial analysis <MapPin size={14} />
                  </button>
                  <button onClick={() => navigate('/app/overview')} className="inline-flex items-center gap-1.5 px-3.5 h-9 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-sm">
                    View full report <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </Card>

            {analysis && (
              <Card className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">What we checked</div>
                    <div className="text-[18px] text-stone-900 mt-1">{analysis.resolution?.legal_name || analysis.resolution?.normalized_name}</div>
                    <div className="text-[12px] text-stone-500 mt-1">
                      Identity, public coverage, company documents, and nearby biodiversity context.
                    </div>
                  </div>
                  <Chip tone={analysis.resolution?.abr?.success ? 'emerald' : 'amber'}>
                    {analysis.resolution?.abr?.success ? 'Company matched' : 'Match needs review'}
                  </Chip>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {completedChecks.map((check) => {
                    const Icon = check.icon;
                    const toneStyles = {
                      stone: 'bg-stone-50 border-stone-200 text-stone-700',
                      emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
                      blue: 'bg-sky-50 border-sky-200 text-sky-800',
                      amber: 'bg-amber-50 border-amber-200 text-amber-800',
                      purple: 'bg-purple-50 border-purple-200 text-purple-800',
                    } as const;
                    return (
                      <div key={check.label} className={`rounded-xl border p-4 ${toneStyles[check.tone]}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex size-9 items-center justify-center rounded-xl bg-white/80">
                            <Icon size={16} />
                          </div>
                          {check.done ? (
                            <CheckCircle2 size={15} className={check.tone === 'stone' ? 'text-stone-400' : ''} />
                          ) : (
                            <CircleDot size={15} className="text-stone-400" />
                          )}
                        </div>
                        <div className="mt-4 text-[12px] uppercase tracking-[0.14em] opacity-75">{check.label}</div>
                        <div className="mt-1 text-[18px] font-medium text-stone-950">{check.value}</div>
                        <div className="mt-1 text-[12px] leading-relaxed text-stone-600">{check.detail}</div>
                      </div>
                    );
                  })}
                </div>

                {skippedReports.length > 0 && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
                    <div className="font-medium">Some uploaded reports were skipped.</div>
                    <div className="mt-1 text-amber-800">
                      {skippedReports.slice(0, 2).map(report => report.reason || `${report.name || 'Report'} did not match the selected company.`).join(' ')}
                    </div>
                  </div>
                )}

                <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">Search terms used</div>
                    <div className="text-[26px] text-stone-900 mt-1">{analysis.search_queries?.length || 0}</div>
                    <div className="text-[11px] text-stone-500 mt-1">phrases used to look for relevant coverage</div>
                  </div>
                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">Articles reviewed</div>
                    <div className="text-[26px] text-stone-900 mt-1">{newsCandidates.length || analysis.news?.candidate_count || 0}</div>
                    <div className="text-[11px] text-stone-500 mt-1">news items checked for biodiversity relevance</div>
                  </div>
                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">Clear findings</div>
                    <div className="text-[26px] text-stone-900 mt-1">{evidenceRecords.length}</div>
                    <div className="text-[11px] text-stone-500 mt-1">
                      {hasUploadedReports ? 'from public coverage and uploaded reports' : 'from public coverage'}
                    </div>
                  </div>
                </div>

                {evidenceRecords.length > 0 ? (
                  <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {evidenceRecords.slice(0, 4).map((record, index) => (
                      <div key={`${record.source_type || 'evidence'}-${record.source_url || record.source || index}`} className="p-4 rounded-xl border border-stone-100 bg-white">
                        <div className="flex items-center gap-2 mb-2">
                          <Chip tone={record.source_type === 'report' ? 'blue' : 'stone'}>{record.source_type || 'evidence'}</Chip>
                          <span className="text-[11px] text-stone-400 truncate">{record.source}</span>
                        </div>
                        <div className="text-[13px] text-stone-900">{record.biodiversity_signal || 'Biodiversity evidence found'}</div>
                        <div className="text-[12px] text-stone-500 mt-1">{record.location || 'Location not specified'} - {record.evidence_type || 'unknown evidence type'}</div>
                        <div className="mt-2"><Confidence value={Math.round(((record.confidence || record.llm_confidence || 0.5) <= 1 ? (record.confidence || record.llm_confidence || 0.5) * 100 : (record.confidence || record.llm_confidence || 50)))} /></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`mt-5 rounded-xl border p-4 ${
                    reviewTakeaway.tone === 'amber'
                      ? 'border-amber-200 bg-amber-50'
                      : reviewTakeaway.tone === 'emerald'
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-stone-200 bg-stone-50'
                  }`}>
                    <div className="text-[14px] font-medium text-stone-950">{reviewTakeaway.title}</div>
                    <div className="mt-1 text-[13px] leading-relaxed text-stone-600">{reviewTakeaway.body}</div>
                  </div>
                )}

                {newsCandidates.length > 0 && (
                  <div className="mt-5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400 mb-2">News candidates reviewed</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {newsCandidates.slice(0, 4).map((candidate, index) => (
                        <a
                          key={`${candidate.url || candidate.title || 'candidate'}-${index}`}
                          href={candidate.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block p-4 rounded-xl border border-stone-100 bg-stone-50 hover:bg-white hover:border-emerald-200 transition"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Chip tone="stone">news</Chip>
                            <span className="text-[11px] text-stone-400 truncate">{candidate.source || candidate.source_type || 'Source'}</span>
                          </div>
                          <div className="text-[13px] text-stone-900 leading-snug">{candidate.title || 'Untitled candidate'}</div>
                          {candidate.snippet && <div className="text-[12px] text-stone-500 mt-1 line-clamp-2">{candidate.snippet}</div>}
                          {candidate.selection_reason && (
                            <div className="mt-2 text-[11px] text-emerald-700">{candidate.selection_reason}</div>
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Card className="p-6 md:col-span-1">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">Nature risk score</div>
                  {finalBiodiversityScore !== null && (
                    <Chip tone="emerald">Final</Chip>
                  )}
                </div>
                {finalBiodiversityScore !== null ? (
                  <>
                    <div className="flex items-end gap-2">
                      <div className="text-[64px] leading-none tracking-tight text-amber-600">{finalBiodiversityScore}</div>
                      <div className="text-stone-500 mb-2">/100</div>
                    </div>
                    <ScoreDisclaimer className="mt-2" />
                    <div className="mt-2"><RiskBadge level={riskLevelFromScore(finalBiodiversityScore)} /></div>
                    <div className="mt-4 h-2 bg-stone-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500" style={{ width: `${finalBiodiversityScore}%` }} />
                    </div>
                    <div className="mt-2 flex justify-between text-[10px] text-stone-400 font-mono">
                      <span>0 - LOW</span><span>50</span><span>100 - CRITICAL</span>
                    </div>
                    {typeof effectiveSpatialAnalysis?.confidence_score === 'number' && (
                      <div className="mt-2 text-[11px] text-stone-500">
                        Confidence {Math.round(effectiveSpatialAnalysis.confidence_score)}/100
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-rose-700">Species score</div>
                        <div className="mt-1 font-mono text-[16px] leading-none text-stone-950">{speciesComponentScore.toFixed(1)}</div>
                      </div>
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-emerald-700">Land signals</div>
                        <div className="mt-1 font-mono text-[16px] leading-none text-stone-950">{landSignals.computed ? landSignalComponentScore.toFixed(1) : '...'}</div>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-rose-700">Threatened</div>
                        <div className="mt-1 text-[18px] leading-none text-stone-950">{landSignals.computed ? landSignals.threatenedSpecies : '...'}</div>
                      </div>
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-emerald-700">Protected</div>
                        <div className="mt-1 text-[18px] leading-none text-stone-950">{landSignals.computed ? landSignals.protectedAreas : '...'}</div>
                      </div>
                      <div className="rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-blue-700">KBA</div>
                        <div className="mt-1 text-[18px] leading-none text-stone-950">{landSignals.computed ? landSignals.kbas : '...'}</div>
                      </div>
                      <div className="rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-sky-700">IBRA</div>
                        <div className="mt-1 text-[18px] leading-none text-stone-950">{landSignals.computed ? landSignals.bioregions : '...'}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] leading-relaxed text-stone-500">
                      {landSignals.computed
                        ? 'Land signals are included in this score alongside threatened species and evidence pressure.'
                        : 'Land-signal counts appear after the resolved location has been computed by the backend.'}
                    </div>
                    {spatialError && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
                        Spatial score could not be refreshed. Showing the last available result.
                      </div>
                    )}
                    {noDetectedBiodiversitySignal && (
                      <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] leading-relaxed text-emerald-800">
                        No biodiversity signal was detected from the current location, news, and uploaded-report inputs.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 p-4">
                    <div className="text-[24px] leading-tight text-stone-900">Pending nature risk score</div>
                    <div className="mt-2 text-[12px] leading-relaxed text-stone-600">
                      The score will appear after the backend combines spatial land signals, threatened species, evidence pressure, and confidence.
                    </div>
                    {spatialError && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
                        {spatialError}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <Card className="p-6 md:col-span-2">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck size={16} className="text-emerald-600" />
                  <div className="text-[13px] uppercase tracking-wider text-stone-500">Why this score</div>
                </div>
                <ul className="space-y-2.5">
                  {scoreReasons.map((reason, index) => (
                    <li key={`${reason}-${index}`} className="flex gap-3 text-[13px] text-stone-700">
                      <CircleDot size={14} className={`${index === 0 ? 'text-amber-500' : index === 1 ? 'text-emerald-500' : 'text-orange-500'} mt-0.5 shrink-0`} />
                      {reason}
                    </li>
                  ))}
                </ul>
                {scoreDrivers.length > 0 && (
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {scoreDrivers.slice(0, 5).map(driver => (
                      <div key={driver.key} className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium text-stone-800">{driver.label}</span>
                          <span className="font-mono text-[12px] text-stone-900">{Math.round(driver.score)}/100</span>
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-stone-500">{driver.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

          </div>
        )}
      </section>
    </div>
  );
}
