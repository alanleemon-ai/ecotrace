import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { BookOpen, Compass, X } from "lucide-react";
import { currentPageTourId, tours, type TourDefinition, type TourId, type TourStep } from "./tours";

const HELP_VERSION = "epic-7-v1";
const HELP_VERSION_KEY = "seeco_help_version";
const HELP_INTRO_KEY = "seeco_help_seen_intro";
const HELP_COMPLETED_KEY = "seeco_help_completed_tours";

type HelpContextValue = {
  activeTour: TourDefinition | null;
  activeStepIndex: number;
  currentPageTour: TourDefinition | null;
  completedTourIds: TourId[];
  startTour: (tourId: TourId) => void;
  openIntro: () => void;
};

const HelpContext = createContext<HelpContextValue | null>(null);

function readCompletedTourIds(): TourId[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HELP_COMPLETED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function targetRect(step: TourStep | undefined) {
  if (!step?.target) return null;
  const element = document.querySelector<HTMLElement>(step.target);
  return element?.getBoundingClientRect() ?? null;
}

function tooltipStyle(rect: DOMRect | null, placement: TourStep["placement"]): CSSProperties {
  const width = Math.min(360, window.innerWidth - 32);
  if (!rect || placement === "center") {
    return {
      left: "50%",
      top: "50%",
      width,
      transform: "translate(-50%, -50%)",
    };
  }

  const gap = 16;
  const safeLeft = (value: number) => clamp(value, 16, window.innerWidth - width - 16);
  const centeredLeft = safeLeft(rect.left + rect.width / 2 - width / 2);
  const preferred = placement ?? "bottom";

  if (preferred === "top") {
    return { left: centeredLeft, top: Math.max(16, rect.top - gap), width, transform: "translateY(-100%)" };
  }
  if (preferred === "left") {
    return {
      left: safeLeft(rect.left - width - gap),
      top: clamp(rect.top + rect.height / 2, 16, window.innerHeight - 16),
      width,
      transform: "translateY(-50%)",
    };
  }
  if (preferred === "right") {
    return {
      left: safeLeft(rect.right + gap),
      top: clamp(rect.top + rect.height / 2, 16, window.innerHeight - 16),
      width,
      transform: "translateY(-50%)",
    };
  }

  const useTop = rect.bottom + gap + 190 > window.innerHeight;
  return useTop
    ? { left: centeredLeft, top: Math.max(16, rect.top - gap), width, transform: "translateY(-100%)" }
    : { left: centeredLeft, top: rect.bottom + gap, width };
}

export function HelpProvider({
  children,
  autoPrompt = true,
}: {
  children: ReactNode;
  autoPrompt?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTourId, setActiveTourId] = useState<TourId | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const [completedTourIds, setCompletedTourIds] = useState<TourId[]>(readCompletedTourIds);
  const activeTour = activeTourId ? tours[activeTourId] : null;
  const activeStep = activeTour?.steps[activeStepIndex];
  const pageTourId = currentPageTourId(location.pathname);
  const currentPageTour = pageTourId ? tours[pageTourId] : null;

  const startTour = useCallback((tourId: TourId) => {
    setIntroOpen(false);
    setActiveTourId(tourId);
    setActiveStepIndex(0);
  }, []);

  const closeTour = useCallback((completed = false) => {
    if (completed && activeTourId) {
      setCompletedTourIds((current) => {
        const next = current.includes(activeTourId) ? current : [...current, activeTourId];
        window.localStorage.setItem(HELP_COMPLETED_KEY, JSON.stringify(next));
        return next;
      });
    }
    setActiveTourId(null);
    setActiveStepIndex(0);
    setSpotlightRect(null);
  }, [activeTourId]);

  const openIntro = useCallback(() => {
    setIntroOpen(true);
  }, []);

  useEffect(() => {
    if (!autoPrompt || typeof window === "undefined") return;
    const version = window.localStorage.getItem(HELP_VERSION_KEY);
    const introSeen = window.localStorage.getItem(HELP_INTRO_KEY) === "true";
    if (version === HELP_VERSION && introSeen) return;

    const timer = window.setTimeout(() => setIntroOpen(true), 450);
    return () => window.clearTimeout(timer);
  }, [autoPrompt]);

  useEffect(() => {
    if (!activeStep?.route || activeStep.route === location.pathname) return;
    navigate(activeStep.route);
  }, [activeStep?.route, location.pathname, navigate]);

  useEffect(() => {
    if (!activeTour || !activeStep || (activeStep.route && activeStep.route !== location.pathname)) {
      setSpotlightRect(null);
      return;
    }

    let frame = 0;
    const update = () => {
      const rect = targetRect(activeStep);
      setSpotlightRect(rect);
    };
    const scrollTargetIntoView = () => {
      if (!activeStep.target) return;
      document.querySelector<HTMLElement>(activeStep.target)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    };

    frame = window.requestAnimationFrame(() => {
      scrollTargetIntoView();
      update();
    });
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [activeStep, activeTour, location.pathname]);

  useEffect(() => {
    if (!activeTour) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTour(false);
      if (event.key === "ArrowLeft") setActiveStepIndex((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") {
        setActiveStepIndex((current) => {
          if (current >= activeTour.steps.length - 1) {
            closeTour(true);
            return current;
          }
          return current + 1;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTour, closeTour]);

  const contextValue = useMemo<HelpContextValue>(() => ({
    activeTour,
    activeStepIndex,
    currentPageTour,
    completedTourIds,
    startTour,
    openIntro,
  }), [activeStepIndex, activeTour, completedTourIds, currentPageTour, openIntro, startTour]);

  const dismissIntro = () => {
    window.localStorage.setItem(HELP_VERSION_KEY, HELP_VERSION);
    window.localStorage.setItem(HELP_INTRO_KEY, "true");
    setIntroOpen(false);
  };

  return (
    <HelpContext.Provider value={contextValue}>
      {children}
      {introOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-stone-950/35 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="help-welcome-title" className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  <Compass className="size-4" />
                </div>
                <h2 id="help-welcome-title" className="mt-3 text-[20px] font-semibold text-stone-950">
                  Learn your way around Seeco
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-stone-600">
                  Take a short tour of the pages, then replay page guides or task flows from Help whenever you need them.
                </p>
              </div>
              <button type="button" onClick={dismissIntro} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Close help welcome">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={dismissIntro} className="h-9 rounded-lg px-3 text-[13px] text-stone-600 hover:bg-stone-100">
                Skip for now
              </button>
              <button
                type="button"
                onClick={() => {
                  dismissIntro();
                  startTour("product-tour");
                }}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-[13px] text-white hover:bg-emerald-800"
              >
                <BookOpen className="size-4" />
                Start tour
              </button>
            </div>
          </div>
        </div>
      )}
      {activeTour && activeStep && (
        <TourOverlay
          tour={activeTour}
          step={activeStep}
          stepIndex={activeStepIndex}
          rect={spotlightRect}
          onBack={() => setActiveStepIndex((current) => Math.max(0, current - 1))}
          onNext={() => {
            if (activeStepIndex >= activeTour.steps.length - 1) closeTour(true);
            else setActiveStepIndex((current) => current + 1);
          }}
          onClose={() => closeTour(false)}
        />
      )}
    </HelpContext.Provider>
  );
}

function TourOverlay({
  tour,
  step,
  stepIndex,
  rect,
  onBack,
  onNext,
  onClose,
}: {
  tour: TourDefinition;
  step: TourStep;
  stepIndex: number;
  rect: DOMRect | null;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const paddedRect = rect
    ? {
        top: Math.max(8, rect.top - 8),
        left: Math.max(8, rect.left - 8),
        width: rect.width + 16,
        height: rect.height + 16,
      }
    : null;
  const finalStep = stepIndex === tour.steps.length - 1;

  return (
    <div className="fixed inset-0 z-[85]">
      {paddedRect ? (
        <>
          <div className="absolute left-0 right-0 top-0 bg-stone-950/50" style={{ height: paddedRect.top }} />
          <div className="absolute bottom-0 left-0 right-0 bg-stone-950/50" style={{ top: paddedRect.top + paddedRect.height }} />
          <div className="absolute left-0 bg-stone-950/50" style={{ top: paddedRect.top, width: paddedRect.left, height: paddedRect.height }} />
          <div className="absolute right-0 bg-stone-950/50" style={{ top: paddedRect.top, left: paddedRect.left + paddedRect.width, height: paddedRect.height }} />
          <div
            className="pointer-events-none absolute rounded-xl ring-2 ring-emerald-400 ring-offset-2 ring-offset-white"
            style={paddedRect}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-stone-950/50" />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label={tour.title}
        className="absolute rounded-xl border border-stone-200 bg-white p-4 shadow-2xl"
        style={tooltipStyle(rect, step.placement)}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase text-emerald-700">
              {tour.kind === "flow" ? "Guide" : "Tour"} {stepIndex + 1}/{tour.steps.length}
            </div>
            <div className="mt-1 text-[16px] font-semibold text-stone-950">{step.title}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Close tour">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-stone-600">{step.body}</p>
        {step.target && !rect && (
          <p className="mt-2 text-[11px] text-amber-700">
            This step appears when its page content is available.
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" onClick={onClose} className="text-[12px] text-stone-500 hover:text-stone-800">
            Skip
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              disabled={stepIndex === 0}
              className="h-8 rounded-lg border border-stone-200 px-3 text-[12px] text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onNext}
              className="h-8 rounded-lg bg-emerald-700 px-3 text-[12px] text-white hover:bg-emerald-800"
            >
              {finalStep ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useHelp() {
  const context = useContext(HelpContext);
  if (!context) throw new Error("useHelp must be used within HelpProvider");
  return context;
}
