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
import { Card, Chip, Confidence, SectionTitle } from '../components/shared';
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

function statTone(count: number): 'emerald' | 'amber' | 'stone' {
  if (count > 0) return 'emerald';
  return 'stone';
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'stone',
}: {
  icon: typeof Newspaper;
  label: string;
  value: string | number;
  detail: string;
  tone?: 'emerald' | 'amber' | 'rose' | 'blue' | 'stone';
}) {
  const iconTone = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    blue: 'bg-blue-50 text-blue-700',
    stone: 'bg-stone-100 text-stone-600',
  }[tone];

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${iconTone}`}>
          <Icon size={17} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-stone-400">{label}</div>
          <div className="mt-1 text-[24px] leading-none text-stone-950">{value}</div>
          <div className="mt-1 text-[11px] leading-snug text-stone-500">{detail}</div>
        </div>
      </div>
    </Card>
  );
}

function EvidenceRow({ record, index }: { record: BackendEvidenceRecord; index: number }) {
  const conf = confidencePercent(record);
  const title = evidenceTitle(record);
  const source = record.source || 'News source';

  return (
    <div className="border-b border-stone-100 px-5 py-4 last:border-b-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip tone={evidenceTone(record)}>{evidenceLabel(record)}</Chip>
            {record.activity_type && <Chip tone="stone">{sentenceCase(record.activity_type)}</Chip>}
            <span className="text-[11px] text-stone-400">#{index + 1}</span>
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

  return (
    <div className="min-h-[calc(100vh-65px)] bg-stone-50">
      <div className="mx-auto max-w-7xl px-6 py-7">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-stone-400">News Analyze</div>
            <h1 className="mt-2 truncate text-[28px] leading-tight text-stone-950">{companyName}</h1>
            <div className="mt-1 text-[13px] text-stone-500">
              News candidates, extracted biodiversity evidence, and source traceability from the latest company run.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip tone={statTone(newsEvidence.length)}>{newsEvidence.length} news evidence</Chip>
            <Chip tone={statTone(candidateCount)}>{candidateCount} candidates</Chip>
            <Chip tone={reportEvidenceCount ? 'blue' : 'stone'}>{reportEvidenceCount} report signals</Chip>
          </div>
        </div>

        <div data-tour="analyse-summary" className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <SummaryMetric
            icon={Newspaper}
            label="Candidate Articles"
            value={candidateCount}
            detail={`${queryList.length} search quer${queryList.length === 1 ? 'y' : 'ies'} sent to providers`}
            tone={statTone(candidateCount)}
          />
          <SummaryMetric
            icon={ShieldCheck}
            label="Extracted Evidence"
            value={newsEvidence.length}
            detail={`${highConfidence} high-confidence news signal${highConfidence === 1 ? '' : 's'}`}
            tone={statTone(newsEvidence.length)}
          />
          <SummaryMetric
            icon={AlertTriangle}
            label="Risk Signals"
            value={riskSignals}
            detail={`${regulatorySignals} regulatory signal${regulatorySignals === 1 ? '' : 's'} found`}
            tone={riskSignals ? 'rose' : 'stone'}
          />
          <SummaryMetric
            icon={Activity}
            label="Avg Confidence"
            value={newsEvidence.length ? `${avgConfidence}%` : 'N/A'}
            detail={`${allEvidence.length} total evidence record${allEvidence.length === 1 ? '' : 's'} available`}
            tone={avgConfidence >= 75 ? 'emerald' : avgConfidence ? 'amber' : 'stone'}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-12">
          <Card className="overflow-hidden xl:col-span-8" data-tour="analyse-evidence">
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
              <div className="text-[13px] uppercase tracking-wider text-stone-500">News Evidence Found</div>
              <Chip tone={newsEvidence.length ? 'emerald' : 'stone'}>{newsEvidence.length} records</Chip>
            </div>
            {newsEvidence.length ? (
              <div>
                {newsEvidence.map((record, index) => (
                  <EvidenceRow
                    key={`${record.source_url || record.source || 'news'}-${index}`}
                    record={record}
                    index={index}
                  />
                ))}
              </div>
            ) : (
              <div className="px-5 py-12 text-center">
                <div className="mx-auto flex size-11 items-center justify-center rounded-lg bg-stone-100 text-stone-500">
                  <Newspaper size={19} />
                </div>
                <div className="mt-3 text-[15px] text-stone-900">No extracted news evidence found</div>
                <div className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-stone-500">
                  Candidate articles may still have been reviewed; check the reviewed news list and search queries.
                </div>
              </div>
            )}
          </Card>

          <div className="space-y-5 xl:col-span-4">
            <Card data-tour="analyse-reviewed-news" className="overflow-hidden">
              <div className="border-b border-stone-200 px-4 py-4">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] uppercase tracking-wider text-stone-500">Reviewed News</div>
                  <Chip tone="stone">{candidateCount}</Chip>
                </div>
              </div>
              {newsCandidates.length ? (
                <div className="max-h-[440px] overflow-y-auto">
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
              <SectionTitle title="Search Queries" action={<Search size={14} className="text-stone-400" />} />
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
        </div>
      </div>
    </div>
  );
}
