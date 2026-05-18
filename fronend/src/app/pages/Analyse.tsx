import { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  FileText,
  Newspaper,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Card, Chip, Confidence } from '../components/shared';
import {
  allEvidenceRecords,
  companyDisplayName,
  confidencePercent,
  loadCompanyAnalysis,
  type BackendEvidenceRecord,
  type BackendNewsCandidate,
} from '../lib/analysis';

function formatDate(value?: string | null) {
  if (!value) return 'Latest analysis';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sentenceCase(value?: string | null) {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function evidenceTitle(record: BackendEvidenceRecord) {
  return (
    sentenceCase(record.biodiversity_signal) ||
    sentenceCase(record.activity_type) ||
    sentenceCase(record.evidence_type) ||
    'Biodiversity evidence found'
  );
}

function evidenceTone(record: BackendEvidenceRecord): 'rose' | 'amber' | 'emerald' | 'blue' | 'stone' {
  const type = (record.evidence_type || '').toLowerCase();
  if (type.includes('risk')) return 'rose';
  if (type.includes('regulatory')) return 'amber';
  if (type.includes('action')) return 'emerald';
  if (type.includes('disclosure')) return 'blue';
  return 'stone';
}

function evidenceLabel(record: BackendEvidenceRecord) {
  return sentenceCase(record.evidence_type) || 'Evidence';
}

function candidateKey(candidate: BackendNewsCandidate, index: number) {
  return `${candidate.url || candidate.title || candidate.source || 'candidate'}-${index}`;
}

function readableSummary({
  evidenceCount,
  riskSignals,
  regulatorySignals,
  avgConfidence,
}: {
  evidenceCount: number;
  riskSignals: number;
  regulatorySignals: number;
  avgConfidence: number;
}) {
  if (evidenceCount === 0) {
    return {
      title: 'No strong biodiversity story was extracted from the latest news scan',
      body: 'Articles may still have been reviewed, but none were converted into a clear biodiversity evidence record for this company.',
      takeaway: 'Low extracted signal',
    };
  }
  if (riskSignals > 0 || regulatorySignals > 0) {
    return {
      title: 'The latest scan found news worth a closer look',
      body: `${evidenceCount} biodiversity evidence ${evidenceCount === 1 ? 'record was' : 'records were'} extracted, including ${riskSignals} risk ${riskSignals === 1 ? 'signal' : 'signals'} and ${regulatorySignals} regulatory ${regulatorySignals === 1 ? 'signal' : 'signals'}.`,
      takeaway: avgConfidence >= 75 ? 'Review with higher confidence' : 'Review, but with caution',
    };
  }
  return {
    title: 'The latest scan found biodiversity-related coverage',
    body: `${evidenceCount} biodiversity evidence ${evidenceCount === 1 ? 'record was' : 'records were'} extracted, with no direct risk or regulatory signal currently standing out.`,
    takeaway: avgConfidence >= 75 ? 'Useful supporting context' : 'Supporting context with lower confidence',
  };
}

function SignalCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Newspaper;
  label: string;
  value: string | number;
  detail: string;
  tone: 'emerald' | 'amber' | 'rose' | 'sky';
}) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  } as const;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex size-9 items-center justify-center rounded-xl ring-1 ${tones[tone]}`}>
          <Icon className="size-4" />
        </div>
        <div className="text-[24px] font-medium tabular-nums text-stone-950">{value}</div>
      </div>
      <div className="mt-4 text-[13px] font-medium text-stone-950">{label}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-stone-600">{detail}</p>
    </Card>
  );
}

function EvidenceCard({ record, index }: { record: BackendEvidenceRecord; index: number }) {
  const conf = confidencePercent(record);
  const title = evidenceTitle(record);
  const source = record.source || 'News source';

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip tone={evidenceTone(record)}>{evidenceLabel(record)}</Chip>
            {record.activity_type && <Chip tone="stone">{sentenceCase(record.activity_type)}</Chip>}
            <span className="text-[11px] text-stone-400">Evidence {index + 1}</span>
          </div>
          <div className="text-[15px] font-medium leading-snug text-stone-950">{title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-stone-500">
            <span>{source}</span>
            <span className="text-stone-300">|</span>
            <span>{formatDate(record.source_date)}</span>
            {record.location && (
              <>
                <span className="text-stone-300">|</span>
                <span>{record.location}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 lg:w-56">
          <Confidence value={conf} />
          {record.source_url ? (
            <a
              href={record.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 hover:text-emerald-700"
              aria-label="Open source"
            >
              <ExternalLink size={14} />
            </a>
          ) : (
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-stone-50 text-stone-400">
              <FileText size={14} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CandidateRow({ candidate, index }: { candidate: BackendNewsCandidate; index: number }) {
  return (
    <div className="border-b border-stone-100 px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-[13px] font-medium leading-snug text-stone-900">
            {candidate.title || 'Untitled news candidate'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500">
            <span>{candidate.source || 'News source'}</span>
            <span className="text-stone-300">|</span>
            <span>{formatDate(candidate.published_date)}</span>
          </div>
          {candidate.snippet && (
            <div className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-stone-500">
              {candidate.snippet}
            </div>
          )}
        </div>
        {candidate.url ? (
          <a
            href={candidate.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 hover:text-emerald-700"
            aria-label={`Open candidate ${index + 1}`}
          >
            <ExternalLink size={14} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function PlainLanguageGuide() {
  const items = [
    {
      term: 'Candidate article',
      meaning: 'A news item the system reviewed because it might matter.',
    },
    {
      term: 'Evidence record',
      meaning: 'A candidate that was strong enough to extract into a concrete biodiversity signal.',
    },
    {
      term: 'Risk signal',
      meaning: 'Coverage suggesting possible biodiversity harm, pressure, or controversy.',
    },
    {
      term: 'Confidence',
      meaning: 'How strongly the extracted evidence appears to support the signal.',
    },
  ];

  return (
    <Card className="p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
        Plain-language guide
      </div>
      <h3 className="mt-2 text-[18px] text-stone-950">How to read this page</h3>
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

export function Analyse() {
  const analysis = useMemo(() => loadCompanyAnalysis(), []);
  const companyName = companyDisplayName(analysis);
  const allEvidence = useMemo(() => allEvidenceRecords(analysis), [analysis]);
  const newsEvidence = useMemo(
    () => (analysis?.news?.evidence || []).filter(record => record.source_type === 'news' || !record.source_type),
    [analysis],
  );
  const reportEvidenceCount = analysis?.reports?.evidence_count ?? analysis?.reports?.evidence?.length ?? 0;
  const newsCandidates = analysis?.news?.candidates || [];
  const candidateCount = analysis?.news?.candidate_count ?? newsCandidates.length;
  const riskSignals = newsEvidence.filter(record => (record.evidence_type || '').toLowerCase().includes('risk')).length;
  const regulatorySignals = newsEvidence.filter(record => (record.evidence_type || '').toLowerCase().includes('regulatory')).length;
  const highConfidence = newsEvidence.filter(record => confidencePercent(record) >= 75).length;
  const avgConfidence = newsEvidence.length
    ? Math.round(newsEvidence.reduce((sum, record) => sum + confidencePercent(record), 0) / newsEvidence.length)
    : 0;
  const queryList = analysis?.search_queries || [];
  const summary = readableSummary({
    evidenceCount: newsEvidence.length,
    riskSignals,
    regulatorySignals,
    avgConfidence,
  });

  return (
    <div className="min-h-[calc(100vh-65px)] bg-gradient-to-b from-[#f5f3ee] via-[#eef1ec] to-[#e3ebe4]">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-7">
        <section className="relative min-h-[240px] overflow-hidden rounded-2xl text-white">
          <img
            src="/images/news-hero.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-stone-950/92 via-stone-950/72 to-emerald-950/20" />
          <div className="relative flex min-h-[240px] flex-col justify-end p-6 md:p-8">
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-100/90">
              News analysis
            </div>
            <h1 className="mt-2 max-w-3xl text-[30px] leading-tight text-white md:text-[36px]">
              What is the latest news saying about {companyName}?
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-emerald-50/95 md:text-[14px]">
              A simpler view of the articles reviewed, the biodiversity evidence extracted, and the signals that may deserve closer attention.
            </p>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
              Latest takeaway
            </div>
            <h2 className="mt-2 text-[25px] leading-tight text-stone-950">{summary.title}</h2>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-stone-600">{summary.body}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700">
                {candidateCount} articles reviewed
              </span>
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700">
                {newsEvidence.length} evidence records
              </span>
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700">
                {reportEvidenceCount} report signals
              </span>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="relative h-32 overflow-hidden">
              <img src="/images/news-evidence.png" alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/70 via-stone-950/20 to-transparent" />
              <div className="absolute bottom-4 left-4 text-[13px] font-medium text-white">
                {summary.takeaway}
              </div>
            </div>
            <div className="p-4">
              <div className="text-[12px] text-stone-500">Average confidence</div>
              <div className="mt-1 text-[30px] leading-none text-stone-950">
                {newsEvidence.length ? `${avgConfidence}%` : 'N/A'}
              </div>
              <div className="mt-3 text-[12px] leading-relaxed text-stone-600">
                {highConfidence} high-confidence news {highConfidence === 1 ? 'signal was' : 'signals were'} extracted in the latest run.
              </div>
            </div>
          </Card>
        </section>

        <section data-tour="analyse-summary" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SignalCard
            icon={Newspaper}
            label="Articles reviewed"
            value={candidateCount}
            detail={`${queryList.length} search ${queryList.length === 1 ? 'query' : 'queries'} used to gather recent coverage.`}
            tone="sky"
          />
          <SignalCard
            icon={ShieldCheck}
            label="Evidence extracted"
            value={newsEvidence.length}
            detail="Articles that became concrete biodiversity evidence records."
            tone="emerald"
          />
          <SignalCard
            icon={AlertTriangle}
            label="Risk and regulatory signals"
            value={riskSignals + regulatorySignals}
            detail={`${riskSignals} risk ${riskSignals === 1 ? 'signal' : 'signals'} and ${regulatorySignals} regulatory ${regulatorySignals === 1 ? 'signal' : 'signals'}.`}
            tone="rose"
          />
          <SignalCard
            icon={Activity}
            label="Confidence"
            value={newsEvidence.length ? `${avgConfidence}%` : 'N/A'}
            detail={`${allEvidence.length} total evidence ${allEvidence.length === 1 ? 'record is' : 'records are'} available across news and reports.`}
            tone={avgConfidence >= 75 ? 'emerald' : 'amber'}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <div data-tour="analyse-evidence">
              <div className="mb-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
                  What matters most
                </div>
                <h2 className="mt-1 text-[22px] text-stone-950">News evidence found</h2>
              </div>
              {newsEvidence.length ? (
                <div className="space-y-3">
                  {newsEvidence.map((record, index) => (
                    <EvidenceCard
                      key={`${record.source_url || record.source || 'news'}-${index}`}
                      record={record}
                      index={index}
                    />
                  ))}
                </div>
              ) : (
                <Card className="px-5 py-12 text-center">
                  <div className="mx-auto flex size-11 items-center justify-center rounded-lg bg-stone-100 text-stone-500">
                    <Newspaper size={19} />
                  </div>
                  <div className="mt-3 text-[15px] text-stone-900">No extracted news evidence found</div>
                  <div className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-stone-500">
                    Articles may still have been reviewed; check the reviewed list for what was screened.
                  </div>
                </Card>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <PlainLanguageGuide />

            <Card data-tour="analyse-reviewed-news" className="overflow-hidden">
              <div className="border-b border-stone-200 px-4 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
                      Checked by the system
                    </div>
                    <div className="mt-1 text-[16px] text-stone-950">Reviewed articles</div>
                  </div>
                  <Chip tone="stone">{candidateCount}</Chip>
                </div>
              </div>
              {newsCandidates.length ? (
                <div className="max-h-[420px] overflow-y-auto">
                  {newsCandidates.slice(0, 10).map((candidate, index) => (
                    <CandidateRow key={candidateKey(candidate, index)} candidate={candidate} index={index} />
                  ))}
                </div>
              ) : (
                <div className="px-4 py-8 text-[12px] text-stone-500">
                  No candidate article list is attached to the latest analysis.
                </div>
              )}
            </Card>

            <Card data-tour="analyse-search-queries" className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-800/70">
                    Search coverage
                  </div>
                  <div className="mt-1 text-[16px] text-stone-950">Queries used</div>
                </div>
                <Search size={14} className="text-stone-400" />
              </div>
              {queryList.length ? (
                <div className="space-y-2">
                  {queryList.slice(0, 6).map((query, index) => (
                    <div key={`${query}-${index}`} className="rounded-lg bg-stone-50 px-3 py-2 text-[12px] leading-relaxed text-stone-700">
                      {query}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-stone-50 px-3 py-3 text-[12px] text-stone-500">
                  Search queries will appear after a company analysis run.
                </div>
              )}
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
