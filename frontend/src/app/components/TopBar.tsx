import { useEffect, useRef, useState } from 'react';
import { BookOpen, Compass, HelpCircle, Map, Route } from 'lucide-react';
import { useHelp } from '../help/HelpProvider';

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { currentPageTour, startTour, openIntro } = useHelp();

  useEffect(() => {
    if (!helpOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setHelpOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [helpOpen]);

  const runTour = (tourId: Parameters<typeof startTour>[0]) => {
    startTour(tourId);
    setHelpOpen(false);
  };

  return (
    <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-stone-200">
      <div className="px-8 py-4 flex items-center gap-6">
        <div className="min-w-0">
          <div className="text-[18px] text-stone-900 leading-tight">{title}</div>
          {subtitle && <div className="text-[12px] text-stone-500 leading-tight">{subtitle}</div>}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              data-tour="help-menu"
              onClick={() => setHelpOpen((open) => !open)}
              className="w-9 h-9 rounded-lg hover:bg-stone-100 flex items-center justify-center text-stone-500"
              aria-label="Open help"
              aria-expanded={helpOpen}
              title="Help and tours"
            >
              <HelpCircle size={16} />
            </button>
            {helpOpen && (
              <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl">
                <div className="border-b border-stone-100 px-4 py-3">
                  <div className="text-[13px] font-semibold text-stone-950">Help</div>
                  <div className="mt-0.5 text-[11px] text-stone-500">Tours and task guides</div>
                </div>
                <div className="p-2">
                  <button
                    type="button"
                    onClick={() => runTour('product-tour')}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-stone-50"
                  >
                    <Compass className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                    <span>
                      <span className="block text-[13px] text-stone-900">Product tour</span>
                      <span className="block text-[11px] text-stone-500">Main navigation and page roles</span>
                    </span>
                  </button>
                  {currentPageTour && (
                    <button
                      type="button"
                      onClick={() => runTour(currentPageTour.id)}
                      className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-stone-50"
                    >
                      <BookOpen className="mt-0.5 size-4 shrink-0 text-blue-700" />
                      <span>
                        <span className="block text-[13px] text-stone-900">Learn this page</span>
                        <span className="block text-[11px] text-stone-500">{currentPageTour.title}</span>
                      </span>
                    </button>
                  )}
                  <div className="my-2 border-t border-stone-100" />
                  <button
                    type="button"
                    onClick={() => runTour('assess-company-flow')}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-stone-50"
                  >
                    <Route className="mt-0.5 size-4 shrink-0 text-amber-700" />
                    <span>
                      <span className="block text-[13px] text-stone-900">Assess a company</span>
                      <span className="block text-[11px] text-stone-500">Search to monitoring workflow</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runTour('inspect-spatial-flow')}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-stone-50"
                  >
                    <Map className="mt-0.5 size-4 shrink-0 text-sky-700" />
                    <span>
                      <span className="block text-[13px] text-stone-900">Inspect spatial exposure</span>
                      <span className="block text-[11px] text-stone-500">Map and species workflow</span>
                    </span>
                  </button>
                </div>
                <div className="border-t border-stone-100 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      openIntro();
                      setHelpOpen(false);
                    }}
                    className="text-[11px] text-stone-500 hover:text-stone-800"
                  >
                    Show welcome prompt
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
