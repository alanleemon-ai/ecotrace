import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  Bell,
  Building2,
  ChevronDown,
  Clock3,
  Database,
  FileText,
  ExternalLink,
  Leaf,
  MapPin,
  RefreshCw,
  Search,
  Save,
  Shield,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Chip, InfoTip, RiskBadge, type RiskLevel } from '../components/shared';
import type { CompanyWatchlistRecord } from '../../lib/api';
import type { BackendCompanyAnalysis } from '../lib/analysis';
import { WatchlistMap, type WatchlistMapMarker } from '../components/watchlist-map';
import {
  currentUserIdentity,
  loadCompanyWatchlistForCurrentUser,
  removeCompanyWatchlistForCurrentUser,
  updateCompanyWatchlistForCurrentUser,
} from '../lib/companyWatchlist';

type SortKey = 'risk' | 'date' | 'name';
type AlertStatus = 'Increasing' | 'Stable' | 'Decreasing';

const riskLevelFromScore = (score?: number | null): RiskLevel => {
  const value = score ?? 0;
  if (value >= 85) return 'Critical';
  if (value >= 65) return 'High';
  if (value >= 35) return 'Medium';
  return 'Low';
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Not synced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const scoreTrend = (company: CompanyWatchlistRecord): AlertStatus => {
  const previous = Number(company.metadata_json?.previous_score ?? company.risk_score ?? 0);
  const current = company.risk_score ?? 0;
  if (current - previous >= 4) return 'Increasing';
  if (previous - current >= 4) return 'Decreasing';
  return 'Stable';
};

function companyAnalysisTarget(company: CompanyWatchlistRecord): string {
  return (company.abn || company.company_name).trim();
}

function analysisSnapshotFor(company: CompanyWatchlistRecord): BackendCompanyAnalysis | null {
  const snapshot = company.metadata_json?.analysis_snapshot;
  if (!snapshot || typeof snapshot !== 'object') return null;
  return snapshot as BackendCompanyAnalysis;
}

function overviewSnapshotFor(company: CompanyWatchlistRecord): BackendCompanyAnalysis {
  const savedSnapshot = analysisSnapshotFor(company);
  if (savedSnapshot) return savedSnapshot;

  const metadata = company.metadata_json || {};
  return {
    query_id: company.query_id || null,
    resolution: {
      legal_name: company.company_name,
      normalized_name: company.company_name,
      input_value: company.company_name,
      abn: company.abn || null,
      state: typeof metadata.state === 'string' ? metadata.state : null,
      postcode: typeof metadata.postcode === 'string' ? metadata.postcode : null,
      abr: {
        success: Boolean(company.abn),
        message: 'Loaded from company watchlist',
      },
    },
    news: {
      candidate_count: typeof metadata.news_candidate_count === 'number' ? metadata.news_candidate_count : 0,
      candidates: [],
      evidence: [],
    },
    reports: {
      evidence_count: 0,
      evidence: [],
    },
    analysed_reports: [],
  };
}

function savedLocationFor(company: CompanyWatchlistRecord) {
  const metadata = company.metadata_json || {};
  const savedSnapshot = analysisSnapshotFor(company);
  const spatial = savedSnapshot?.spatial_analysis;
  const inferred = spatial?.inferred_location;
  const location = spatial?.location;
  const lat = typeof metadata.lat === 'number' ? metadata.lat : inferred?.lat ?? location?.lat;
  const lon = typeof metadata.lon === 'number' ? metadata.lon : inferred?.lon ?? location?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat: lat as number,
    lon: lon as number,
    label:
      (typeof metadata.location_label === 'string' ? metadata.location_label : null) ||
      inferred?.label ||
      location?.label ||
      company.region ||
      'Saved analysis location',
  };
}

function watchlistMarkerFor(company: CompanyWatchlistRecord): WatchlistMapMarker | null {
  const location = savedLocationFor(company);
  if (!location) return null;
  return {
    id: company.watchlist_id,
    label: company.company_name,
    subtitle: location.label,
    lat: location.lat,
    lon: location.lon,
    riskScore: company.risk_score,
    riskLevel: riskLevelFromScore(company.risk_score),
  };
}

function confidenceFor(company: CompanyWatchlistRecord) {
  const confidence = company.metadata_json?.confidence;
  return typeof confidence === 'number' ? `${confidence}% confidence` : 'Confidence not captured';
}

function companyTakeaways(company: CompanyWatchlistRecord) {
  const metadata = company.metadata_json || {};
  const threatened = metadata.threatened_species_count;
  const reports = metadata.report_count;
  const news = metadata.news_candidate_count;
  const location = savedLocationFor(company);
  return [
    typeof threatened === 'number'
      ? `${threatened} threatened ${threatened === 1 ? 'species' : 'species'} captured in the saved spatial snapshot.`
      : 'Threatened-species exposure has not been captured yet.',
    typeof reports === 'number'
      ? `${reports} report ${reports === 1 ? 'item' : 'items'} reviewed in the latest saved analysis.`
      : 'Report coverage has not been captured yet.',
    typeof news === 'number'
      ? `${news} news ${news === 1 ? 'candidate' : 'candidates'} screened for recent external signals.`
      : 'News screening has not been captured yet.',
    location
      ? `Mapped location saved for ${location.label}.`
      : 'No mapped operating location is saved yet; re-run analysis to add one.',
  ];
}

function portfolioCoverage(companies: CompanyWatchlistRecord[]) {
  return companies.filter((company) => savedLocationFor(company)).length;
}

export function Watchlist() {
  const navigate = useNavigate();
  const identity = useMemo(() => currentUserIdentity(), []);
  const [companies, setCompanies] = useState<CompanyWatchlistRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<'All' | RiskLevel>('All');
  const [sort, setSort] = useState<SortKey>('risk');
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'backend' | 'local'>('local');
  const [message, setMessage] = useState<string | null>(null);

  const loadWatchlist = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await loadCompanyWatchlistForCurrentUser();
      setCompanies(result.records);
      setSource(result.source);
      setSelectedId((current) => current && result.records.some((record) => record.watchlist_id === current)
        ? current
        : result.records[0]?.watchlist_id ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load watchlist.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWatchlist();
  }, []);

  const filteredCompanies = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    const rows = companies.filter((company) => {
      const matchesQuery = !lowered || [
        company.company_name,
        company.abn || '',
        company.industry || '',
        company.region || '',
      ].some((value) => value.toLowerCase().includes(lowered));
      const matchesRisk = riskFilter === 'All' || riskLevelFromScore(company.risk_score) === riskFilter;
      return matchesQuery && matchesRisk;
    });

    return rows.sort((a, b) => {
      if (sort === 'date') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      if (sort === 'name') return a.company_name.localeCompare(b.company_name);
      return (b.risk_score ?? 0) - (a.risk_score ?? 0);
    });
  }, [companies, query, riskFilter, sort]);

  const selectedCompany = filteredCompanies.find((company) => company.watchlist_id === selectedId) ?? filteredCompanies[0] ?? null;
  const averageRisk = companies.length
    ? Math.round(companies.reduce((total, company) => total + (company.risk_score ?? 0), 0) / companies.length)
    : 0;
  const highRiskCount = companies.filter((company) => ['High', 'Critical'].includes(riskLevelFromScore(company.risk_score))).length;
  const alertCount = companies.filter((company) => company.alerts_enabled).length;
  const mappedCount = portfolioCoverage(companies);
  const markers = useMemo(
    () => companies.map(watchlistMarkerFor).filter((marker): marker is WatchlistMapMarker => Boolean(marker)),
    [companies],
  );

  const removeCompany = async (company: CompanyWatchlistRecord) => {
    const confirmed = window.confirm(`Remove ${company.company_name} from your watchlist?`);
    if (!confirmed) return;
    await removeCompanyWatchlistForCurrentUser(company.watchlist_id);
    setCompanies((current) => current.filter((record) => record.watchlist_id !== company.watchlist_id));
    if (selectedId === company.watchlist_id) setSelectedId(null);
    setMessage(`${company.company_name} removed from your watchlist.`);
  };

  const openCompanyOverview = (company: CompanyWatchlistRecord) => {
    const snapshot = overviewSnapshotFor(company);
    window.localStorage.setItem('company_analysis', JSON.stringify(snapshot));
    if (snapshot.query_id) window.localStorage.setItem('query_id', snapshot.query_id);
    if (snapshot.spatial_analysis) {
      window.localStorage.setItem('latest_spatial_analysis', JSON.stringify(snapshot.spatial_analysis));
    }
    navigate('/app/overview');
  };

  const analyseLatest = (company: CompanyWatchlistRecord) => {
    navigate(`/app/analyse?company=${encodeURIComponent(companyAnalysisTarget(company))}&autorun=1`);
  };

  const updateCompany = async (
    company: CompanyWatchlistRecord,
    patch: { alerts_enabled?: boolean; notes?: string | null },
  ) => {
    const result = await updateCompanyWatchlistForCurrentUser(company.watchlist_id, patch);
    setCompanies((current) =>
      current.map((record) => record.watchlist_id === result.record.watchlist_id ? result.record : record),
    );
    setSource(result.source);
    return result.record;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f5f3ee] via-[#eef1ec] to-[#e3ebe4]">
      <div className="mx-auto max-w-[1500px] space-y-5 px-5 py-5">
        <section className="relative min-h-[220px] overflow-hidden rounded-2xl text-white">
          <img
            src="/images/trusted-sources/kba.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-stone-950/92 via-emerald-950/78 to-emerald-950/25" />
          <div className="relative flex min-h-[220px] flex-col justify-end p-6 md:p-8">
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-100/90">
              Investor watchlist
            </div>
            <h1 className="mt-2 max-w-3xl text-[30px] leading-tight text-white md:text-[36px]">
              Monitor biodiversity exposure across the companies you follow
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-emerald-50/95 md:text-[14px]">
              Keep score changes, saved evidence, threatened-species exposure, and mapped operating locations in one investor view.
            </p>
          </div>
        </section>

        <section data-tour="watchlist-summary" className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[22px] font-semibold text-stone-950">Portfolio watchlist</div>
                <Chip tone={source === 'backend' ? 'emerald' : 'amber'}>
                  <Database className="size-3" /> {source === 'backend' ? 'Database synced' : 'Local fallback'}
                </Chip>
              </div>
              <div className="mt-1 text-[13px] text-stone-600">
                Monitoring for {identity.email || identity.userId || 'local demo user'} · {mappedCount}/{companies.length || 0} companies mapped.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void loadWatchlist()}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 text-[12px] text-stone-700 hover:bg-stone-50"
              >
                <RefreshCw className="size-4" /> Refresh
              </button>
              <button
                onClick={() => navigate('/app/overview')}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-[12px] text-white hover:bg-emerald-800"
              >
                <Building2 className="size-4" /> Add from overview
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <SummaryCard label="Watched companies" value={String(companies.length)} icon={Building2} hint="Companies currently under review" />
            <SummaryCard label="Average risk" value={companies.length ? `${averageRisk}/100` : 'N/A'} icon={AlertTriangle} hint="Portfolio-level watch signal" />
            <SummaryCard label="High-risk holdings" value={String(highRiskCount)} icon={TrendingUp} hint="High or critical tier" />
            <SummaryCard label="Mapped companies" value={`${mappedCount}/${companies.length || 0}`} icon={MapPin} hint={`${alertCount} alert rules active`} />
          </div>
        </section>

        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-800">
            {message}
          </div>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
                Portfolio geography
              </div>
              <h2 className="mt-1 text-[20px] text-stone-950">Where watched companies are exposed</h2>
            </div>
            <div className="text-[12px] text-stone-500">
              Click a marker to select that company.
            </div>
          </div>
          <WatchlistMap markers={markers} selectedId={selectedCompany?.watchlist_id} onSelect={setSelectedId} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(420px,0.92fr)_minmax(0,1.08fr)]">
          <div data-tour="watchlist-list" className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <div data-tour="watchlist-filters" className="mb-4 flex flex-col gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search watched company"
                  className="h-10 w-full rounded-lg border border-stone-200 bg-stone-50 pl-9 pr-3 text-[13px] outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(['All', 'Low', 'Medium', 'High', 'Critical'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setRiskFilter(level)}
                    className={`h-8 rounded-lg px-3 text-[12px] transition ${
                      riskFilter === level ? 'bg-emerald-700 text-white' : 'border border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {level}
                  </button>
                ))}
                <label className="relative ml-auto">
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortKey)}
                    className="h-8 appearance-none rounded-lg border border-stone-200 bg-white pl-3 pr-8 text-[12px] text-stone-700 outline-none focus:border-emerald-500"
                  >
                    <option value="risk">Risk score</option>
                    <option value="date">Last updated</option>
                    <option value="name">Company name</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
                </label>
              </div>
            </div>

            {loading ? (
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-[13px] text-stone-500">
                Loading your company watchlist...
              </div>
            ) : companies.length === 0 ? (
              <EmptyWatchlist onAdd={() => navigate('/app/overview')} />
            ) : filteredCompanies.length === 0 ? (
              <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-5 text-[13px] text-stone-500">
                No watched companies match the current filters.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCompanies.map((company) => {
                  const selected = selectedCompany?.watchlist_id === company.watchlist_id;
                  const trend = scoreTrend(company);
                  const TrendIcon = trend === 'Increasing' ? TrendingUp : trend === 'Decreasing' ? TrendingDown : Clock3;
                  return (
                    <button
                      key={company.watchlist_id}
                      onClick={() => setSelectedId(company.watchlist_id)}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        selected ? 'border-emerald-500 bg-emerald-50' : 'border-stone-200 bg-white hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-[12px] font-semibold text-white">
                          {company.company_name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-stone-950">{company.company_name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                            <span>{company.industry || 'Industry unavailable'}</span>
                            <span className="h-1 w-1 rounded-full bg-stone-300" />
                            <span>{company.region || 'Region unavailable'}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <RiskBadge level={riskLevelFromScore(company.risk_score)} label={`${company.risk_score ?? 'N/A'}/100`} />
                            <Chip tone={company.alerts_enabled ? 'emerald' : 'stone'}>
                              <Bell className="size-3" /> {company.alerts_enabled ? 'Alerts on' : 'Alerts off'}
                            </Chip>
                            <span className="inline-flex items-center gap-1 text-[11px] text-stone-500">
                              <TrendIcon className="size-3" /> {trend}
                            </span>
                            <span className="text-[11px] text-stone-400">Updated {formatDate(company.updated_at)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div data-tour="watchlist-monitor">
            <CompanyMonitorPanel
              company={selectedCompany}
              onRemove={selectedCompany ? () => void removeCompany(selectedCompany) : undefined}
              onOpenOverview={selectedCompany ? () => openCompanyOverview(selectedCompany) : undefined}
              onAnalyseLatest={selectedCompany ? () => analyseLatest(selectedCompany) : undefined}
              onUpdate={selectedCompany ? (patch) => updateCompany(selectedCompany, patch) : undefined}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function CompanyMonitorPanel({
  company,
  onRemove,
  onOpenOverview,
  onAnalyseLatest,
  onUpdate,
}: {
  company: CompanyWatchlistRecord | null;
  onRemove?: () => void;
  onOpenOverview?: () => void;
  onAnalyseLatest?: () => void;
  onUpdate?: (patch: { alerts_enabled?: boolean; notes?: string | null }) => Promise<CompanyWatchlistRecord>;
}) {
  const [notesDraft, setNotesDraft] = useState(company?.notes || '');
  const [saving, setSaving] = useState(false);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);

  useEffect(() => {
    setNotesDraft(company?.notes || '');
    setPanelMessage(null);
  }, [company?.watchlist_id, company?.notes]);

  if (!company) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-[13px] text-stone-500">
          Select a watched company to view its monitoring dashboard.
        </div>
      </div>
    );
  }

  const metadata = company.metadata_json || {};
  const trend = scoreTrend(company);
  const trendTone = trend === 'Increasing' ? 'text-rose-700' : trend === 'Decreasing' ? 'text-emerald-700' : 'text-stone-600';
  const takeaways = companyTakeaways(company);
  const savedLocation = savedLocationFor(company);
  const savedSnapshot = analysisSnapshotFor(company);
  const confidence = confidenceFor(company);

  const saveNotes = async () => {
    if (!onUpdate) return;
    setSaving(true);
    setPanelMessage(null);
    try {
      await onUpdate({ notes: notesDraft.trim() || null });
      setPanelMessage('Investment note saved.');
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : 'Could not save note.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAlerts = async () => {
    if (!onUpdate) return;
    setSaving(true);
    setPanelMessage(null);
    try {
      await onUpdate({ alerts_enabled: !company.alerts_enabled });
      setPanelMessage(company.alerts_enabled ? 'Alerts paused.' : 'Alerts enabled.');
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : 'Could not update alerts.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[20px] font-semibold text-stone-950">{company.company_name}</div>
              <RiskBadge level={riskLevelFromScore(company.risk_score)} />
            </div>
            <div className="mt-1 text-[12px] text-stone-500">
              ABN {company.abn || 'not available'} · Added {formatDate(company.created_at)} · {confidence}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onOpenOverview}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-stone-200 px-3 text-[12px] text-stone-700 hover:bg-stone-50"
            >
              <ExternalLink className="size-4" /> Open overview
            </button>
            <button
              onClick={onAnalyseLatest}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-[12px] text-white hover:bg-emerald-800"
            >
              <RefreshCw className="size-4" /> Analyse latest
            </button>
            <button
              onClick={onRemove}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-200 px-3 text-[12px] text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="size-4" /> Remove
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <SummaryCard label="Risk score" value={company.risk_score != null ? `${company.risk_score}/100` : 'N/A'} icon={AlertTriangle} hint="Saved watchlist score" />
          <SummaryCard label="Risk trend" value={trend} icon={trend === 'Increasing' ? TrendingUp : trend === 'Decreasing' ? TrendingDown : Clock3} className={trendTone} hint="Compared with saved prior score" />
          <SummaryCard label="Threatened species" value={String(metadata.threatened_species_count ?? 'N/A')} icon={Leaf} hint="Saved spatial snapshot" />
          <SummaryCard label="Evidence reports" value={String(metadata.report_count ?? 'N/A')} icon={Shield} hint="Reports reviewed" />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
            Investor brief
          </div>
          <h3 className="mt-2 text-[18px] text-stone-950">Why this company is on watch</h3>
          <div className="mt-4 space-y-3">
            {takeaways.map((item) => (
              <div key={item} className="flex gap-3 rounded-xl bg-stone-50 px-3 py-2.5">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-emerald-600" />
                <div className="text-[12px] leading-relaxed text-stone-600">{item}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[13px] font-semibold text-stone-950">Private investment note</div>
              <button
                type="button"
                onClick={() => void saveNotes()}
                disabled={saving}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-700 px-2.5 text-[11px] text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                <Save className="size-3.5" />
                Save
              </button>
            </div>
            <textarea
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              placeholder="Add portfolio context, thesis notes, or follow-up questions."
              className="min-h-[86px] w-full resize-none rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[12px] text-stone-700 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-stone-950">
            Monitoring controls
            <InfoTip text="Company-level indicators are captured from the analysis at the time it is added to the watchlist." />
          </div>
          <div className="space-y-3">
            <IndicatorRow label="Spatial status" value={String(metadata.spatial_status || 'pending')} />
            <IndicatorRow label="News candidates" value={String(metadata.news_candidate_count ?? 'N/A')} />
            <IndicatorRow label="Reports reviewed" value={String(metadata.report_count ?? 'N/A')} />
            <IndicatorRow label="Confidence" value={metadata.confidence != null ? `${metadata.confidence}%` : 'N/A'} />
            <IndicatorRow label="Mapped site" value={savedLocation?.label || 'Not saved'} />
            <IndicatorRow label="Last synced" value={formatDate(company.updated_at)} />
          </div>

          <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-900">
                <Bell className="size-4 text-amber-600" />
                Alert rule
              </div>
              <button
                type="button"
                onClick={() => void toggleAlerts()}
                disabled={saving}
                className={`relative h-5 w-9 rounded-full transition ${
                  company.alerts_enabled ? 'bg-emerald-600' : 'bg-stone-300'
                }`}
                aria-label={company.alerts_enabled ? 'Disable alerts' : 'Enable alerts'}
              >
                <span
                  className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition ${
                    company.alerts_enabled ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
            <div className="text-[12px] leading-relaxed text-stone-600">
              {company.alerts_enabled
                ? 'Monitoring is active for score changes and refreshed biodiversity evidence.'
                : 'Monitoring is paused for this company.'}
            </div>
          </div>

          {panelMessage && (
            <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
              {panelMessage}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-stone-950">
          <FileText className="size-4 text-emerald-700" />
          Saved analysis snapshot
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <SnapshotCard label="Mapped location" value={savedLocation?.label || 'Not saved'} />
          <SnapshotCard label="News evidence" value={String(metadata.news_candidate_count ?? 'N/A')} />
          <SnapshotCard label="Spatial score" value={
            typeof savedSnapshot?.spatial_analysis?.combined_biodiversity_score === 'number'
              ? `${savedSnapshot.spatial_analysis.combined_biodiversity_score}/100`
              : typeof savedSnapshot?.spatial_analysis?.species_threat_score === 'number'
                ? `${savedSnapshot.spatial_analysis.species_threat_score}/100`
                : 'N/A'
          } />
        </div>
      </section>
    </div>
  );
}

function EmptyWatchlist({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-white text-stone-500 ring-1 ring-stone-200">
        <Building2 className="size-6" />
      </div>
      <div className="mt-3 text-[15px] font-semibold text-stone-950">No companies watched yet</div>
      <div className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-stone-600">
        Run or open a company analysis, then add that company from the Company Overview page.
      </div>
      <button
        onClick={onAdd}
        className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-[12px] text-white hover:bg-emerald-800"
      >
        <Building2 className="size-4" /> Go to Company Overview
      </button>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  className = '',
  hint,
}: {
  label: string;
  value: string;
  icon: typeof Building2;
  className?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-stone-500">
        <Icon className="size-3.5 text-emerald-700" />
        {label}
      </div>
      <div className={`text-[20px] font-semibold text-stone-950 ${className}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-stone-400">{hint}</div>}
    </div>
  );
}

function SnapshotCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-stone-50 p-4">
      <div className="text-[11px] text-stone-500">{label}</div>
      <div className="mt-1 text-[15px] font-medium text-stone-950">{value}</div>
    </div>
  );
}

function IndicatorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-2 text-[12px] last:border-0">
      <span className="text-stone-500">{label}</span>
      <span className="text-right font-medium text-stone-900">{value}</span>
    </div>
  );
}
