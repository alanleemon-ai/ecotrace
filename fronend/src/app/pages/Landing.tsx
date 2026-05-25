import { useState } from 'react';
import { Leaf, ArrowRight, Search, BarChart3, Shield, TrendingDown, Newspaper, Users, Briefcase, Sparkles, MapPin } from 'lucide-react';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';

import { useNavigate } from 'react-router';

const HERO_IMG = 'https://images.unsplash.com/photo-1758702160898-6f96d1db5b73?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhdXN0cmFsaWFuJTIwcmFpbmZvcmVzdCUyMGNhbm9weSUyMGJpb2RpdmVyc2l0eXxlbnwxfHx8fDE3NzcwMjk1MTV8MA&ixlib=rb-4.1.0&q=80&w=1920';
const FOREST_IMG = 'https://images.unsplash.com/photo-1771894543689-49e43c124ac1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwyfHxhdXN0cmFsaWFuJTIwcmFpbmZvcmVzdCUyMGNhbm9weSUyMGJpb2RpdmVyc2l0eXxlbnwxfHx8fDE3NzcwMjk1MTV8MA&ixlib=rb-4.1.0&q=80&w=1080';
const MINE_IMG = 'https://images.unsplash.com/photo-1684050610978-89a6032f93d9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwyfHxtaW5pbmclMjBpbmR1c3RyaWFsJTIwbGFuZHNjYXBlJTIwYWVyaWFsJTIwYXVzdHJhbGlhfGVufDF8fHx8MTc3NzAyOTUxOXww&ixlib=rb-4.1.0&q=80&w=1080';
const REEF_IMG = 'https://images.unsplash.com/photo-1638580591001-8c07e6f54097?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwyfHxncmVhdCUyMGJhcnJpZXIlMjByZWVmJTIwY29yYWwlMjBiaW9kaXZlcnNpdHl8ZW58MXx8fHwxNzc3MDI5NTIzfDA&ixlib=rb-4.1.0&q=80&w=1080';
const KANGAROO_IMG = 'https://images.unsplash.com/photo-1605583953063-972168057f1a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxrYW5nYXJvbyUyMGF1c3RyYWxpYW4lMjBvdXRiYWNrJTIwd2lsZGxpZmV8ZW58MXx8fHwxNzc3MDI5NTI2fDA&ixlib=rb-4.1.0&q=80&w=1080';

const stats = [
  { value: '69%', label: 'Average decline in monitored wildlife populations since 1970', source: 'WWF Living Planet Report' },
  { value: '1M+', label: 'Species threatened with extinction globally', source: 'IPBES' },
  { value: '75%', label: 'Land surface significantly altered by human activity', source: 'UN Environment' },
  { value: '$44T', label: 'Global GDP moderately or highly dependent on nature', source: 'WEF' },
];

const news = [
  {
    tag: 'Identity',
    date: 'Live lookup',
    title: 'Company, brand, barcode, and ABN resolution',
    source: 'ABR · IP Australia · OpenFoodFacts',
    image: MINE_IMG,
    excerpt: 'Seeco starts by linking the user input to a traceable legal entity before any biodiversity evidence is shown.',
  },
  {
    tag: 'Evidence',
    date: 'Per analysis',
    title: 'News and uploaded reports are reviewed separately',
    source: 'News APIs · user-selected files',
    image: KANGAROO_IMG,
    excerpt: 'Public coverage and uploaded company documents are screened for biodiversity-relevant signals with source context.',
  },
  {
    tag: 'Spatial',
    date: 'Nearby scan',
    title: 'Biodiversity context around the inferred location',
    source: 'ALA · IUCN · CAPAD · IBRA · KBA',
    image: REEF_IMG,
    excerpt: 'The map checks species records, conservation status, protected areas, bioregions, and key biodiversity areas nearby.',
  },
  {
    tag: 'Output',
    date: 'After search',
    title: 'Scores, reports, and watchlist snapshots',
    source: 'Seeco backend',
    image: FOREST_IMG,
    excerpt: 'Users can review a nature-risk score, generate a shareable report, and save the company for later refresh.',
  },
];

const investorJourney = [
  { icon: Search, title: 'Search', subtitle: '01 · Input', text: 'Scan a barcode, brand, or ABN. We resolve it to a legal entity in seconds.' },
  { icon: BarChart3, title: 'Analyse', subtitle: '02 · Score', text: 'News, uploaded reports, and nearby spatial signals contribute to a 0-100 nature-risk score.' },
  { icon: Shield, title: 'Evidence', subtitle: '03 · Review', text: 'The result keeps source links, confidence, and location context visible for checking.' },
  { icon: Sparkles, title: 'Act', subtitle: '04 · Follow up', text: 'Export a summary, open the spatial map, or save the company as a watchlist snapshot.' },
];

const consumerJourney = [
  { icon: Search, title: 'Search', subtitle: '01 · Scan', text: 'Search a product barcode or enter a brand you want to check.' },
  { icon: BarChart3, title: 'Analyse', subtitle: '02 · Discover', text: 'See the resolved company and the biodiversity signals Seeco can find from current sources.' },
  { icon: Sparkles, title: 'Act', subtitle: '03 · Compare', text: 'Run another product, brand, or company search to compare results from the same scoring flow.' },
];

// Industrial topographic background
const TopoSvg = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 800 400" preserveAspectRatio="none" fill="none">
    {[0, 1, 2, 3, 4, 5, 6].map(i => (
      <path key={i} d={`M0 ${60 + i * 45} Q 200 ${20 + i * 50}, 400 ${80 + i * 40} T 800 ${50 + i * 45}`} stroke="currentColor" strokeWidth="1" opacity={0.18 - i * 0.015} />
    ))}
  </svg>
);

const Ticks = () => (
  <div className="flex items-center gap-[3px] text-stone-300">
    {Array.from({ length: 28 }).map((_, i) => (
      <span key={i} className={`block w-px ${i % 4 === 0 ? 'h-2.5 bg-stone-400' : 'h-1.5 bg-stone-300'}`} />
    ))}
  </div>
);

function HeroJourneyPreview({ activeJourney }: { activeJourney: 'investor' | 'consumer' }) {
  const steps = activeJourney === 'investor' ? investorJourney : consumerJourney;
  const lineClass = activeJourney === 'investor' ? 'bg-emerald-400/50' : 'bg-blue-300/50';
  const dotClass = activeJourney === 'investor' ? 'bg-emerald-300 text-emerald-950' : 'bg-blue-300 text-blue-950';
  const iconClass = activeJourney === 'investor' ? 'text-emerald-300' : 'text-blue-300';
  const pillClass = activeJourney === 'investor' ? 'text-emerald-200' : 'text-blue-200';

  return (
    <div id="methodology" className="scroll-mt-24 rounded-2xl border border-white/10 bg-stone-950/45 p-5 text-white shadow-[0_18px_60px_-32px_rgba(0,0,0,0.75)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className={`font-mono text-[10px] uppercase tracking-[0.22em] ${activeJourney === 'investor' ? 'text-emerald-300' : 'text-blue-300'}`}>
            User journey
          </div>
          <div className="mt-1 text-[17px] leading-tight text-white">
            {activeJourney === 'investor' ? 'Company due diligence' : 'Product or brand check'}
          </div>
        </div>
        <div className={`rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${pillClass}`}>
          {steps.length} steps
        </div>
      </div>

      <div className="mt-5 space-y-0">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isLast = index === steps.length - 1;
          return (
            <div key={step.title} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
              <div className="relative flex justify-center">
                <div className={`relative z-10 flex size-8 items-center justify-center rounded-full ${dotClass} text-[12px] font-medium`}>
                  {String(index + 1).padStart(2, '0')}
                </div>
                {!isLast && <div className={`absolute top-8 h-full w-px ${lineClass}`} />}
              </div>
              <div className={`pb-4 ${isLast ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2">
                  <Icon size={14} className={iconClass} />
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">{step.subtitle}</div>
                </div>
                <div className="mt-1 text-[14px] font-medium leading-tight text-white">{step.title}</div>
                <div className="mt-1 text-[12px] leading-relaxed text-stone-300">{step.text}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Landing() {
  const navigate = useNavigate();
  const [activeJourney, setActiveJourney] = useState<'investor' | 'consumer'>('investor');

  const handleEnter = () => {
    navigate('/app/search');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f5f3ee] via-[#eef1ec] to-[#e3ebe4] text-stone-900">
      {/* Nav */}
      <div className="relative z-20 max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-lg">
            <Leaf className="text-white" size={18} />
          </div>
          <div>
            <div className="text-[15px] font-semibold text-stone-900 leading-tight tracking-tight">SEECO</div>
            <div className="text-[10px] text-stone-500 leading-tight tracking-[0.2em] uppercase">Biodiversity Intelligence</div>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-7 text-[13px] text-stone-600">
          <a 
            href="#why-biodiversity"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('why-biodiversity')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="hover:text-stone-900 cursor-pointer"
          >
            Why biodiversity
          </a>
          <a 
            href="#news"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('news')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="hover:text-stone-900 cursor-pointer"
          >
            News
          </a>
          <a 
            href="#methodology"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('methodology')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="hover:text-stone-900 cursor-pointer"
          >
            Methodology
          </a>
        </div>
        <button onClick={() => handleEnter()} className="inline-flex items-center gap-1.5 px-4 h-9 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-sm">
          Open app <ArrowRight size={14} />
        </button>
      </div>

      {/* STATS — the state of biodiversity */}
      <section id="why-biodiversity" className="relative max-w-7xl mx-auto px-6 pt-10 pb-16">
        <TopoSvg className="absolute inset-0 w-full h-full text-emerald-800 pointer-events-none opacity-50" />
        <div className="relative">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-rose-500 mb-2 font-mono">
                <TrendingDown size={14} />
                <span>§ 01 · The state of biodiversity</span>
              </div>
              <h2 className="text-[34px] leading-tight tracking-tight text-stone-900 max-w-xl">Biodiversity evidence is scattered. Seeco brings the current signals together.</h2>
            </div>
            <div className="hidden md:block">
              <Ticks />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-stone-200 rounded-2xl overflow-hidden border border-stone-200 shadow-sm">
            {stats.map((s, i) => (
              <div key={s.label} className="bg-white/60 backdrop-blur-sm border-t md:border-t-0 md:border-l border-stone-200/50 p-7 relative hover:bg-white transition-colors">
                <div className="font-mono text-[10px] tracking-[0.2em] text-stone-400 mb-3">0{i + 1} / 04</div>
                <div className="text-[52px] leading-none text-emerald-800 tracking-tight">{s.value}</div>
                <div className="mt-3 text-[13px] text-stone-700 leading-snug font-medium">{s.label}</div>
                <div className="mt-4 pt-3 border-t border-dashed border-stone-200 text-[10px] text-stone-500 font-mono tracking-wider uppercase">Source · {s.source}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HERO */}
      <section className="relative overflow-hidden mt-4 mx-4 md:mx-6 rounded-3xl">
        <div className="absolute inset-0">
          <ImageWithFallback src={HERO_IMG} alt="Australian forest canopy" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-stone-950/70 via-stone-900/60 to-[#f5f3ee]" />
          <div className="absolute inset-0 opacity-30">
            <svg className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <pattern id="heroGrid" width="80" height="80" patternUnits="userSpaceOnUse">
                  <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#d6d3d1" strokeWidth="0.4" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#heroGrid)" />
            </svg>
          </div>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-20 pb-28 md:pt-28 md:pb-36">
          <div className="flex items-center gap-3 mb-6 text-rose-400 font-mono text-[11px] tracking-[0.2em] uppercase">
            <span className="w-8 h-px bg-rose-500/60" />
            <span>Evidence-first biodiversity context for Australian company checks.</span>
          </div>
          <h1 className="text-[44px] md:text-[60px] leading-[1.05] tracking-tight text-white max-w-4xl">
            Understand the company behind a product
            <span className="block italic text-emerald-300 font-light">and the biodiversity signals around it.</span>
          </h1>
          <p className="mt-6 text-stone-200/90 text-[16px] max-w-xl leading-relaxed">
            Seeco resolves barcodes, brands, company names, and ABNs into a legal entity, then combines public evidence, uploaded reports, and nearby spatial biodiversity data into a traceable nature-risk readout.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,760px)_360px] lg:items-stretch">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div
                onMouseEnter={() => setActiveJourney('investor')}
                onFocus={() => setActiveJourney('investor')}
                className="bg-stone-900/40 backdrop-blur-md border border-white/10 p-6 rounded-2xl flex flex-col justify-between group hover:bg-stone-900/60 transition"
              >
                <div>
                  <div className="flex items-center gap-2 text-emerald-400 mb-3">
                    <Briefcase size={18} />
                    <span className="font-mono text-[11px] tracking-[0.15em] uppercase">For Investors</span>
                  </div>
                  <h3 className="text-white text-[18px] md:text-[20px] leading-snug tracking-tight mb-2">
                    Do you need a fast biodiversity evidence check before deeper due diligence?
                  </h3>
                  <p className="text-stone-300 text-[14px] leading-relaxed">
                    Review company identity, public evidence, uploaded disclosures, nearby species signals, and a saved watchlist snapshot.
                  </p>
                </div>
                <button onClick={() => navigate('/app/search?mode=company')} className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 h-11 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 text-[14px] font-medium shadow-[0_8px_24px_-8px_rgba(16,185,129,0.5)] transition-colors">
                  Search Company / ABN <ArrowRight size={15} />
                </button>
              </div>

              <div
                onMouseEnter={() => setActiveJourney('consumer')}
                onFocus={() => setActiveJourney('consumer')}
                className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-2xl flex flex-col justify-between group hover:bg-white/10 transition"
              >
                <div>
                  <div className="flex items-center gap-2 text-blue-300 mb-3">
                    <Users size={18} />
                    <span className="font-mono text-[11px] tracking-[0.15em] uppercase">For Consumers</span>
                  </div>
                  <h3 className="text-white text-[18px] md:text-[20px] leading-snug tracking-tight mb-2">
                    Do you know which company sits behind a product or brand?
                  </h3>
                  <p className="text-stone-300 text-[14px] leading-relaxed">
                    Search a barcode or brand to resolve the owner and see the biodiversity context Seeco can currently support.
                  </p>
                </div>
                <button onClick={() => navigate('/app/search?mode=brand')} className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 h-11 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[14px] font-medium border border-white/20 transition-colors">
                  Search Brand or Barcode <ArrowRight size={15} />
                </button>
              </div>
            </div>

            <HeroJourneyPreview activeJourney={activeJourney} />
          </div>
          
          {/* Industrial measurement strip */}
          <div className="mt-14 pt-6 border-t border-white/15 flex flex-wrap items-center gap-x-10 gap-y-3 text-white/80">
            <div className="font-mono text-[10px] tracking-[0.2em] text-white/50">DATA INPUTS</div>
            {['ABR', 'IP Australia', 'OpenFoodFacts', 'News APIs', 'Uploaded reports', 'ALA', 'IUCN'].map(s => (
              <span key={s} className="text-[12px] tracking-tight">{s}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Split feature — industrial + environment */}
      <section className="max-w-7xl mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative rounded-2xl overflow-hidden aspect-[4/3] md:aspect-auto md:h-[320px]">
            <ImageWithFallback src={MINE_IMG} alt="industrial landscape" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-stone-900/30 to-transparent" />
            <div className="absolute inset-0 p-6 flex flex-col justify-between text-white">
              <div className="font-mono text-[10px] tracking-[0.2em] text-white/70">SECTOR · EXTRACTIVE</div>
              <div>
                <div className="text-[22px] leading-tight">Company evidence context</div>
                <div className="text-[12px] text-white/75 max-w-xs mt-1">Seeco reviews public coverage and uploaded reports for biodiversity-relevant signals tied to the resolved company.</div>
              </div>
            </div>
          </div>
          <div className="relative rounded-2xl overflow-hidden aspect-[4/3] md:aspect-auto md:h-[320px]">
            <ImageWithFallback src={FOREST_IMG} alt="rainforest path" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/85 via-emerald-900/30 to-transparent" />
            <div className="absolute inset-0 p-6 flex flex-col justify-between text-white">
              <div className="font-mono text-[10px] tracking-[0.2em] text-emerald-200">SECTOR · ECOSYSTEM</div>
              <div>
                <div className="text-[22px] leading-tight">Nearby nature context</div>
                <div className="text-[12px] text-white/80 max-w-xs mt-1">Species records, conservation status, protected areas, bioregions, and KBAs are checked around the inferred location.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* NEWS */}
      <section id="news" className="max-w-7xl mx-auto px-6 py-24">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-emerald-700 mb-2 font-mono">
              <Newspaper size={13} />
              <span>§ 03 · Evidence inputs</span>
            </div>
            <h2 className="text-[34px] tracking-tight text-stone-900 leading-tight">What Seeco actually checks</h2>
          </div>
          <button onClick={() => navigate('/app/search')} className="inline-flex items-center gap-1 text-[13px] text-emerald-700 hover:underline cursor-pointer">Run a search <ArrowRight size={12} /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {news.map((n, i) => (
            <article key={n.title} className={`group bg-white border border-stone-200 rounded-2xl overflow-hidden hover:shadow-lg transition ${i === 0 ? 'md:col-span-2 md:flex' : ''}`}>
              <div className={`${i === 0 ? 'md:w-1/2' : ''} aspect-[16/9] md:aspect-auto overflow-hidden ${i === 0 ? 'md:min-h-[280px]' : 'h-48'}`}>
                <ImageWithFallback src={n.image} alt={n.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-700" />
              </div>
              <div className={`p-6 flex flex-col ${i === 0 ? 'md:w-1/2 md:p-8 md:justify-center' : ''}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[10px] tracking-[0.15em] uppercase font-mono">{n.tag}</span>
                  <span className="text-[11px] text-stone-400 font-mono tracking-wider">{n.date} · {n.source}</span>
                </div>
                <h3 className={`${i === 0 ? 'text-[24px]' : 'text-[17px]'} text-stone-900 leading-snug mb-2 tracking-tight`}>{n.title}</h3>
                <p className="text-[13px] text-stone-600 leading-relaxed">{n.excerpt}</p>
                <button onClick={() => navigate('/app/search')} className="mt-4 inline-flex items-center gap-1 text-[12px] text-emerald-700 hover:gap-2 transition-all cursor-pointer">Start from search <ArrowRight size={12} /></button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-stone-200 bg-[#ede9e2]">
        <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-6 text-[13px] text-stone-600">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-emerald-700 rounded-md"><Leaf size={14} className="text-white" /></div>
              <div className="text-stone-900 tracking-tight">Seeco</div>
            </div>
            <div className="text-[12px] text-stone-500 leading-relaxed">Company identity, evidence, and nearby biodiversity context. Built in Australia.</div>
            <div className="mt-3 font-mono text-[10px] tracking-[0.2em] text-stone-400 inline-flex items-center gap-1"><MapPin size={11} /> MELBOURNE · VIC · AU</div>
          </div>
          <div>
            <div className="text-stone-900 mb-3">Platform</div>
            <ul className="space-y-1.5 text-[12px]"><li>Consumer search</li><li>Company overview</li><li>Spatial analysis</li></ul>
          </div>
          <div>
            <div className="text-stone-900 mb-3">Resources</div>
            <ul className="space-y-1.5 text-[12px]"><li>Methodology</li><li>Data sources</li><li>Reports</li><li>Watchlist</li></ul>
          </div>
        </div>
        <div className="border-t border-stone-200">
          <div className="max-w-7xl mx-auto px-6 py-4 text-center md:text-left text-[11px] text-stone-500 font-mono tracking-wider">
            <div>© 2026 SEECO · ALL RIGHTS RESERVED</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
