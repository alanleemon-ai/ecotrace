export type TourId =
  | "product-tour"
  | "search-page"
  | "overview-page"
  | "analyse-page"
  | "spatial-page"
  | "watchlist-page"
  | "assess-company-flow"
  | "inspect-spatial-flow";

export type TourPlacement = "top" | "right" | "bottom" | "left" | "center";

export type TourStep = {
  route?: string;
  target?: string;
  title: string;
  body: string;
  placement?: TourPlacement;
};

export type TourDefinition = {
  id: TourId;
  title: string;
  description: string;
  kind: "tour" | "flow";
  steps: TourStep[];
};

export const tours: Record<TourId, TourDefinition> = {
  "product-tour": {
    id: "product-tour",
    title: "Product tour",
    description: "Learn the main navigation and where each area fits.",
    kind: "tour",
    steps: [
      {
        title: "Welcome to Seeco",
        body: "This quick tour shows where to start, where evidence lives, and where ongoing monitoring happens.",
        placement: "center",
      },
      {
        target: '[data-tour="app-sidebar"]',
        title: "Main navigation",
        body: "The sidebar groups the consumer workflow, analysis tools, and investor monitoring into one persistent rail.",
        placement: "right",
      },
      {
        target: '[data-tour="nav-search"]',
        title: "Consumer Search",
        body: "Start here to resolve a barcode, brand, company name, or ABN into a company analysis.",
        placement: "right",
      },
      {
        target: '[data-tour="nav-overview"]',
        title: "Company Overview",
        body: "Use this page for the consolidated read: company identity, score, evidence, and spatial exposure.",
        placement: "right",
      },
      {
        target: '[data-tour="nav-analyse"]',
        title: "News Analyze",
        body: "Review the news evidence, candidate articles, and generated search queries behind the analysis.",
        placement: "right",
      },
      {
        target: '[data-tour="nav-spatial"]',
        title: "Spatial Analysis",
        body: "Inspect site-level biodiversity exposure, protected-area overlaps, and threatened species occurrences.",
        placement: "right",
      },
      {
        target: '[data-tour="nav-watchlist"]',
        title: "Watchlist",
        body: "Track companies after analysis so risk, evidence, and spatial changes stay visible over time.",
        placement: "right",
      },
      {
        target: '[data-tour="help-menu"]',
        title: "Replay help anytime",
        body: "Open Help to replay this tour, learn the current page, or launch a task guide.",
        placement: "bottom",
      },
    ],
  },
  "search-page": {
    id: "search-page",
    title: "Consumer Search",
    description: "Learn how a search becomes a company analysis.",
    kind: "tour",
    steps: [
      {
        route: "/app/search",
        target: '[data-tour="search-modes"]',
        title: "Choose the input type",
        body: "Switch between barcode, brand, or company/ABN depending on what the user already knows.",
        placement: "bottom",
      },
      {
        route: "/app/search",
        target: '[data-tour="search-entry"]',
        title: "Run the analysis",
        body: "Enter the value here and start the flow. The backend resolves identity first, then gathers evidence and spatial context.",
        placement: "bottom",
      },
      {
        route: "/app/search",
        target: '[data-tour="report-upload"]',
        title: "Add reports",
        body: "Optional reports can be uploaded before analysis so annual or sustainability disclosures join the evidence set.",
        placement: "bottom",
      },
      {
        route: "/app/search",
        target: '[data-tour="search-results"]',
        title: "Continue from results",
        body: "After a company resolves, the result area links onward to the full report and spatial analysis.",
        placement: "top",
      },
    ],
  },
  "overview-page": {
    id: "overview-page",
    title: "Company Overview",
    description: "Understand the consolidated company readout.",
    kind: "tour",
    steps: [
      {
        route: "/app/overview",
        target: '[data-tour="overview-summary"]',
        title: "Company summary",
        body: "This header anchors the legal entity, current risk level, and the main actions for deeper review.",
        placement: "bottom",
      },
      {
        route: "/app/overview",
        target: '[data-tour="overview-investor-read"]',
        title: "Investor read",
        body: "This section turns the analysis into a short decision-ready summary.",
        placement: "bottom",
      },
      {
        route: "/app/overview",
        target: '[data-tour="overview-risk-drivers"]',
        title: "Risk drivers",
        body: "These bars explain which signals are contributing most strongly to the company score.",
        placement: "right",
      },
      {
        route: "/app/overview",
        target: '[data-tour="overview-spatial-exposure"]',
        title: "Spatial exposure",
        body: "The overview keeps a compact view of location, records, species threat, and IUCN contribution.",
        placement: "left",
      },
      {
        route: "/app/overview",
        target: '[data-tour="overview-evidence-dossier"]',
        title: "Evidence dossier",
        body: "Inspect the extracted records here before relying on the final company read.",
        placement: "right",
      },
      {
        route: "/app/overview",
        target: '[data-tour="overview-analyst-actions"]',
        title: "Analyst actions",
        body: "Use these actions to add monitoring, export, or jump into the evidence and spatial workspaces.",
        placement: "left",
      },
    ],
  },
  "analyse-page": {
    id: "analyse-page",
    title: "News Analyze",
    description: "Review the evidence behind the company analysis.",
    kind: "tour",
    steps: [
      {
        route: "/app/analyse",
        target: '[data-tour="analyse-summary"]',
        title: "Evidence summary",
        body: "These metrics show how many articles were reviewed and how much extractable evidence was found.",
        placement: "bottom",
      },
      {
        route: "/app/analyse",
        target: '[data-tour="analyse-evidence"]',
        title: "News evidence found",
        body: "This is the most important panel on the page: extracted biodiversity evidence ready for review.",
        placement: "right",
      },
      {
        route: "/app/analyse",
        target: '[data-tour="analyse-reviewed-news"]',
        title: "Reviewed candidates",
        body: "These are the candidate articles considered during the run, including items that did not become evidence.",
        placement: "left",
      },
      {
        route: "/app/analyse",
        target: '[data-tour="analyse-search-queries"]',
        title: "Generated queries",
        body: "Use these queries to understand how the news providers were searched for the selected company.",
        placement: "left",
      },
    ],
  },
  "spatial-page": {
    id: "spatial-page",
    title: "Spatial Analysis",
    description: "Learn the biodiversity map and Layer A evidence.",
    kind: "tour",
    steps: [
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-context"]',
        title: "Selected company and site",
        body: "This bar shows which company and inferred or selected site the biodiversity query is using.",
        placement: "bottom",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-metrics"]',
        title: "Layer A metrics",
        body: "These figures summarize threat score, records, threatened species, and the active radius.",
        placement: "bottom",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-overlap-cards"]',
        title: "Overlay overlap cards",
        body: "CAPAD, IBRA, and KBA counts summarize database overlaps before you inspect the map geometry.",
        placement: "bottom",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-map"]',
        title: "Interactive map",
        body: "Pan and zoom here to inspect protected areas, bioregions, key biodiversity areas, and occurrence points together.",
        placement: "left",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-map-layers"]',
        title: "Map layers",
        body: "Use these toggles to compare overlays and isolate the evidence you need.",
        placement: "left",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-findings"]',
        title: "Species findings",
        body: "The findings panel explains the threatened-species inventory and IUCN breakdown behind the score.",
        placement: "right",
      },
    ],
  },
  "watchlist-page": {
    id: "watchlist-page",
    title: "Watchlist",
    description: "Learn how ongoing company monitoring works.",
    kind: "tour",
    steps: [
      {
        route: "/app/watchlist",
        target: '[data-tour="watchlist-summary"]',
        title: "Watchlist summary",
        body: "The top panel shows sync status, tracked-company count, and portfolio-level signals.",
        placement: "bottom",
      },
      {
        route: "/app/watchlist",
        target: '[data-tour="watchlist-filters"]',
        title: "Filter and sort",
        body: "Use these controls to narrow the watchlist by company name, risk tier, or update order.",
        placement: "bottom",
      },
      {
        route: "/app/watchlist",
        target: '[data-tour="watchlist-list"]',
        title: "Tracked companies",
        body: "Select a company here to load its current monitoring detail on the right.",
        placement: "right",
      },
      {
        route: "/app/watchlist",
        target: '[data-tour="watchlist-monitor"]',
        title: "Monitoring detail",
        body: "This panel lets the user reopen analysis, refresh evidence, and inspect saved biodiversity indicators.",
        placement: "left",
      },
    ],
  },
  "assess-company-flow": {
    id: "assess-company-flow",
    title: "Assess a company",
    description: "Follow the main company-analysis workflow across pages.",
    kind: "flow",
    steps: [
      {
        route: "/app/search",
        target: '[data-tour="search-entry"]',
        title: "1. Search",
        body: "Start with a company name, ABN, barcode, or brand so Seeco can resolve the underlying entity.",
        placement: "bottom",
      },
      {
        route: "/app/search",
        target: '[data-tour="report-upload"]',
        title: "2. Add supporting reports",
        body: "Attach reports before analysis when you want company disclosures included with news evidence.",
        placement: "bottom",
      },
      {
        route: "/app/overview",
        target: '[data-tour="overview-investor-read"]',
        title: "3. Read the overview",
        body: "Use the overview to get the company-level score and concise interpretation first.",
        placement: "bottom",
      },
      {
        route: "/app/overview",
        target: '[data-tour="overview-risk-drivers"]',
        title: "4. Inspect the drivers",
        body: "Check what is actually moving the score before going deeper.",
        placement: "right",
      },
      {
        route: "/app/analyse",
        target: '[data-tour="analyse-evidence"]',
        title: "5. Verify the evidence",
        body: "Open News Analyze to inspect the records supporting the risk narrative.",
        placement: "right",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-map"]',
        title: "6. Validate location risk",
        body: "Finish by checking spatial overlays and threatened occurrences around the selected site.",
        placement: "left",
      },
      {
        route: "/app/watchlist",
        target: '[data-tour="watchlist-summary"]',
        title: "7. Monitor over time",
        body: "Once the analysis is useful, add the company to the watchlist for ongoing tracking.",
        placement: "bottom",
      },
    ],
  },
  "inspect-spatial-flow": {
    id: "inspect-spatial-flow",
    title: "Inspect spatial exposure",
    description: "Follow the biodiversity-exposure workflow on the spatial page.",
    kind: "flow",
    steps: [
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-context"]',
        title: "1. Confirm the location",
        body: "Start by checking which company and site the analysis is centered on.",
        placement: "bottom",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-overlap-cards"]',
        title: "2. Read overlap counts",
        body: "Use the CAPAD, IBRA, and KBA cards as the quick first pass.",
        placement: "bottom",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-map"]',
        title: "3. Inspect the geometry",
        body: "Pan or zoom the map to see how each overlap sits around the analysed location.",
        placement: "left",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-map-layers"]',
        title: "4. Compare layers",
        body: "Toggle layers to isolate protected areas, bioregions, KBAs, or threatened occurrences.",
        placement: "left",
      },
      {
        route: "/app/spatial",
        target: '[data-tour="spatial-findings"]',
        title: "5. Read species evidence",
        body: "Use the findings panel to connect the map back to species records and IUCN categories.",
        placement: "right",
      },
    ],
  },
};

export function currentPageTourId(pathname: string): TourId | null {
  if (pathname === "/app/search") return "search-page";
  if (pathname === "/app/overview") return "overview-page";
  if (pathname === "/app/analyse") return "analyse-page";
  if (pathname === "/app/spatial") return "spatial-page";
  if (pathname === "/app/watchlist") return "watchlist-page";
  return null;
}
