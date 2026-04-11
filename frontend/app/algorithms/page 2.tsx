

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type MethodologyCategory =
  | "Random forest"
  | "Mutual information"
  | "Correlation"
  | "ODE + regression"
  | "Regression"
  | "Granger causality"
  | "Boolean model";

type AlgorithmEntry = {
  id: string;
  name: string;
  tagline: string;
  category: MethodologyCategory;
  requiresPseudotime: boolean;
  directed: boolean;
  signed: boolean;
  publication: string;
  year: string;
  journal: string;
  runtime: string;
  dockerVersion: string;
  paperUrl: string;
  repoUrl: string;
  strengths: string[];
  limitations: string[];
  recommendedUseCases: string[];
  detail: string;
};

const ALGORITHMS: AlgorithmEntry[] = [
  {
    id: "pidc",
    name: "PIDC",
    tagline: "Information-theoretic method that infers gene relationships using multivariate mutual-information ideas.",
    category: "Mutual information",
    requiresPseudotime: false,
    directed: false,
    signed: false,
    publication: "Chan et al.",
    year: "2017",
    journal: "Cell Systems",
    runtime: "Fast in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1016/j.cels.2017.08.014",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Does not require pseudotime.",
      "Was one of the methods of choice highlighted by BEELINE.",
      "Showed good stability across repeated runs in the BEELINE analysis."
    ],
    limitations: [
      "Produces an undirected network.",
      "Does not provide signed edges."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a mutual-information method."
  },
  {
    id: "genie3",
    name: "GENIE3",
    tagline: "Tree-based GRN inference method that predicts regulators for each target gene.",
    category: "Random forest",
    requiresPseudotime: false,
    directed: true,
    signed: false,
    publication: "Huynh-Thu et al.",
    year: "2010",
    journal: "PLoS One",
    runtime: "Slower than GRNBoost2 in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1371/journal.pone.0012776",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Does not require pseudotime.",
      "Was one of the methods of choice highlighted by BEELINE.",
      "Showed good stability across repeated runs in the BEELINE analysis."
    ],
    limitations: [
      "Does not provide signed edges.",
      "Was slower than GRNBoost2 in the BEELINE runtime comparison."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a random-forest method."
  },
  {
    id: "grnboost2",
    name: "GRNBoost2",
    tagline: "Gradient-boosting based GRN inference method designed as a faster tree-based alternative.",
    category: "Random forest",
    requiresPseudotime: false,
    directed: true,
    signed: false,
    publication: "Moerman et al.",
    year: "2018",
    journal: "Bioinformatics",
    runtime: "Faster than GENIE3 in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/bty916",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Does not require pseudotime.",
      "Was one of the methods of choice highlighted by BEELINE.",
      "Was less sensitive to dropouts than several other methods in the BEELINE analysis."
    ],
    limitations: [
      "Does not provide signed edges.",
      "BEELINE reported lower run-to-run stability than GENIE3 and PIDC."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a random-forest method."
  },
  {
    id: "ppcor",
    name: "PPCOR",
    tagline: "Partial-correlation method that estimates direct linear associations between genes.",
    category: "Correlation",
    requiresPseudotime: false,
    directed: false,
    signed: true,
    publication: "Kim",
    year: "2015",
    journal: "Communications for Statistical Applications and Methods",
    runtime: "Fast in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.5351/CSAM.2015.22.6.665",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Does not require pseudotime.",
      "Provides signed edges.",
      "Fast in the BEELINE runtime comparison."
    ],
    limitations: [
      "Produces an undirected network.",
      "Was not one of the methods of choice highlighted by BEELINE."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a correlation-based method."
  },
  {
    id: "scode",
    name: "SCODE",
    tagline: "Ordinary-differential-equation based method for ordered cells that produces directed signed edges.",
    category: "ODE + regression",
    requiresPseudotime: true,
    directed: true,
    signed: true,
    publication: "Matsumoto et al.",
    year: "2017",
    journal: "Bioinformatics",
    runtime: "Moderate in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btx194",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Produces directed edges.",
      "Produces signed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Was not one of the methods of choice highlighted by BEELINE."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as an ODE-based method."
  },
  {
    id: "sincerities",
    name: "SINCERITIES",
    tagline: "Regression-based method for ordered cells that outputs directed signed edges.",
    category: "Regression",
    requiresPseudotime: true,
    directed: true,
    signed: true,
    publication: "Papili Gao et al.",
    year: "2018",
    journal: "Bioinformatics",
    runtime: "Fast to moderate in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btx575",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Produces directed edges.",
      "Produces signed edges.",
      "Showed stability across runs and dropouts in the BEELINE analysis."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "BEELINE noted sensitivity to pseudotime quality."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a regression-based method."
  },
  {
    id: "scribe",
    name: "SCRIBE",
    tagline: "Directed-information based method for ordered cells that infers directed regulatory links.",
    category: "Mutual information",
    requiresPseudotime: true,
    directed: true,
    signed: false,
    publication: "Qiu et al.",
    year: "2018",
    journal: "bioRxiv preprint",
    runtime: "Slow in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1101/426981",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Produces directed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Slow in the BEELINE runtime comparison.",
      "Was not one of the methods of choice highlighted by BEELINE."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a directed-information based method."
  },
  {
    id: "singe",
    name: "SINGE",
    tagline: "Granger-causality based method for ordered cells that predicts directed relationships.",
    category: "Granger causality",
    requiresPseudotime: true,
    directed: true,
    signed: false,
    publication: "Deshpande et al.",
    year: "2019",
    journal: "bioRxiv preprint",
    runtime: "Very slow in the BEELINE runtime comparison.",
    dockerVersion: "0.4.1",
    paperUrl: "https://doi.org/10.1101/534834",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Produces directed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Very slow in the BEELINE runtime comparison.",
      "Was not one of the methods of choice highlighted by BEELINE."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a Granger-causality based method."
  },
  {
    id: "leap",
    name: "LEAP",
    tagline: "Lag-based correlation method that uses ordered cells to suggest directed relationships.",
    category: "Correlation",
    requiresPseudotime: true,
    directed: true,
    signed: false,
    publication: "Specht and Li",
    year: "2017",
    journal: "Bioinformatics",
    runtime: "Fast in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btw729",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Produces directed edges.",
      "Fast in the BEELINE runtime comparison."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Was not one of the methods of choice highlighted by BEELINE."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a lag-based correlation method."
  },
  {
    id: "grisli",
    name: "GRISLI",
    tagline: "ODE and regression based method for ordered cells that outputs directed edges.",
    category: "ODE + regression",
    requiresPseudotime: true,
    directed: true,
    signed: false,
    publication: "Aubin-Frankowski and Vert",
    year: "2018",
    journal: "bioRxiv preprint",
    runtime: "Moderate to slow in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1101/464479",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Produces directed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Was not one of the methods of choice highlighted by BEELINE."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as an ODE and regression based method."
  },
  {
    id: "grnvbem",
    name: "GRNVBEM",
    tagline: "Variational Bayesian regression method for ordered cells that outputs directed signed edges.",
    category: "Regression",
    requiresPseudotime: true,
    directed: true,
    signed: true,
    publication: "Sanchez-Castillo et al.",
    year: "2018",
    journal: "Bioinformatics",
    runtime: "Slow in the BEELINE runtime comparison.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btx524",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Produces directed edges.",
      "Produces signed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Slow in the BEELINE runtime comparison.",
      "Was not one of the methods of choice highlighted by BEELINE."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a regression-based method."
  },
  {
    id: "scns",
    name: "SCNS",
    tagline: "Boolean-network reconstruction method for ordered cells that produces directed signed edges.",
    category: "Boolean model",
    requiresPseudotime: true,
    directed: true,
    signed: true,
    publication: "Woodhouse et al.",
    year: "2018",
    journal: "BMC Systems Biology",
    runtime: "Long runtime; BEELINE did not report a standard runtime value in the main runtime figure.",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1186/s12918-018-0581-1",
    repoUrl: "https://github.com/murali-group/BEELINE",
    strengths: [
      "Produces directed edges.",
      "Produces signed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Long runtime limited its role in the BEELINE comparison.",
      "Was not one of the methods of choice highlighted by BEELINE."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a Boolean-network reconstruction method."
  }
];

const CATEGORY_OPTIONS: MethodologyCategory[] = [
  "Random forest",
  "Mutual information",
  "Correlation",
  "ODE + regression",
  "Regression",
  "Granger causality",
  "Boolean model"
];

function badgeClass(active: boolean) {
  return active
    ? "border-teal-300/30 bg-teal-300/10 text-teal-100"
    : "border-white/10 bg-white/[0.04] text-slate-300";
}

function cardBadgeClass() {
  return "border-white/10 bg-white/[0.04] text-slate-200";
}

export default function AlgorithmsPage() {
  const [selectedCategories, setSelectedCategories] = useState<MethodologyCategory[]>([]);
  const [requiresPseudotimeOnly, setRequiresPseudotimeOnly] = useState(false);
  const [directedOnly, setDirectedOnly] = useState(false);
  const [signedOnly, setSignedOnly] = useState(false);
  const [selectedAlgorithmId, setSelectedAlgorithmId] = useState<string>("");
  const [closingAlgorithmId, setClosingAlgorithmId] = useState<string | null>(null);
  const [isMethodologyMenuOpen, setIsMethodologyMenuOpen] = useState(false);
  const [isPropertiesMenuOpen, setIsPropertiesMenuOpen] = useState(false);
  const methodologyMenuRef = useRef<HTMLDivElement | null>(null);
  const propertiesMenuRef = useRef<HTMLDivElement | null>(null);
  const methodologyButtonRef = useRef<HTMLButtonElement | null>(null);
  const propertiesButtonRef = useRef<HTMLButtonElement | null>(null);

  const filteredAlgorithms = useMemo(() => {
    return ALGORITHMS.filter((algorithm) => {
      if (
        selectedCategories.length > 0 &&
        !selectedCategories.includes(algorithm.category)
      ) {
        return false;
      }
      if (requiresPseudotimeOnly && !algorithm.requiresPseudotime) {
        return false;
      }
      if (directedOnly && !algorithm.directed) {
        return false;
      }
      if (signedOnly && !algorithm.signed) {
        return false;
      }
      return true;
    });
  }, [directedOnly, requiresPseudotimeOnly, selectedCategories, signedOnly]);

  const activeAlgorithmId = closingAlgorithmId ?? selectedAlgorithmId;

  const selectedAlgorithm =
    activeAlgorithmId.length > 0
      ? ALGORITHMS.find((algorithm) => algorithm.id === activeAlgorithmId) ?? null
      : null;

  const closeAlgorithmModal = () => {
    if (!selectedAlgorithmId || closingAlgorithmId) {
      return;
    }

    setClosingAlgorithmId(selectedAlgorithmId);
    window.setTimeout(() => {
      setSelectedAlgorithmId("");
      setClosingAlgorithmId(null);
    }, 480);
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (
        isMethodologyMenuOpen &&
        methodologyMenuRef.current &&
        !methodologyMenuRef.current.contains(target) &&
        !(methodologyButtonRef.current && methodologyButtonRef.current.contains(target))
      ) {
        setIsMethodologyMenuOpen(false);
      }

      if (
        isPropertiesMenuOpen &&
        propertiesMenuRef.current &&
        !propertiesMenuRef.current.contains(target) &&
        !(propertiesButtonRef.current && propertiesButtonRef.current.contains(target))
      ) {
        setIsPropertiesMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isMethodologyMenuOpen, isPropertiesMenuOpen]);

  return (
    <main className="min-h-screen bg-[#030b24] text-white">
      <section className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.10),_transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0))]">
        <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8 lg:py-12">
          <div className="flex flex-col gap-6">
            <div className="max-w-none">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-teal-200/75 sm:text-sm">
                Algorithms directory
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-[3.15rem] lg:leading-[1.16] lg:whitespace-nowrap">
                Explore algorithms in GRNScope
              </h1>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-8 lg:px-8 lg:py-9">

        <div className="space-y-4">
          <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">All algorithms</h2>
              <p className="mt-1 text-sm text-slate-400">
                {filteredAlgorithms.length} algorithm{filteredAlgorithms.length === 1 ? "" : "s"} match the current filters.
              </p>
            </div>

            <div className="relative flex shrink-0 items-center gap-3 self-start sm:self-auto">
              <button
                ref={methodologyButtonRef}
                type="button"
                onClick={() => {
                  setIsMethodologyMenuOpen((current) => !current);
                  setIsPropertiesMenuOpen(false);
                }}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                  isMethodologyMenuOpen || selectedCategories.length > 0
                    ? "border-teal-300/30 bg-teal-300/10 text-teal-100"
                    : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.08]"
                }`}
              >
                <span>Methodology</span>
                <span
                  className={`text-xs transition ${
                    isMethodologyMenuOpen ? "rotate-180" : ""
                  }`}
                >
                  ▾
                </span>
              </button>

              <button
                ref={propertiesButtonRef}
                type="button"
                onClick={() => {
                  setIsPropertiesMenuOpen((current) => !current);
                  setIsMethodologyMenuOpen(false);
                }}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                  isPropertiesMenuOpen || requiresPseudotimeOnly || directedOnly || signedOnly
                    ? "border-teal-300/30 bg-teal-300/10 text-teal-100"
                    : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.08]"
                }`}
              >
                <span>Properties</span>
                <span
                  className={`text-xs transition ${
                    isPropertiesMenuOpen ? "rotate-180" : ""
                  }`}
                >
                  ▾
                </span>
              </button>

              {isMethodologyMenuOpen ? (
                <div
                  ref={methodologyMenuRef}
                  className="absolute right-0 top-full z-20 mt-3 w-[320px] rounded-[1.5rem] border border-white/10 bg-[#08122f] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">Methodology</p>
                    <button
                      type="button"
                      onClick={() => setSelectedCategories([])}
                      className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 transition hover:text-white"
                    >
                      Select all
                    </button>
                  </div>
                  <div className="mt-4 space-y-3 text-sm text-slate-200">
                    {CATEGORY_OPTIONS.map((option) => {
                      const isChecked = selectedCategories.length === 0
                        ? true
                        : selectedCategories.includes(option);
                      return (
                        <label
                          key={option}
                          className={`flex cursor-pointer items-center justify-between rounded-2xl border px-4 py-3 transition ${badgeClass(isChecked)}`}
                        >
                          <span>{option}</span>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() =>
                              setSelectedCategories((current) => {
                                if (current.length === 0) {
                                  return CATEGORY_OPTIONS.filter((item) => item !== option);
                                }

                                const next = current.includes(option)
                                  ? current.filter((item) => item !== option)
                                  : [...current, option];

                                if (next.length === CATEGORY_OPTIONS.length) {
                                  return [];
                                }

                                return next;
                              })
                            }
                            className="h-4 w-4 rounded border-white/20 bg-transparent"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {isPropertiesMenuOpen ? (
                <div
                  ref={propertiesMenuRef}
                  className="absolute right-0 top-full z-20 mt-3 w-[320px] rounded-[1.5rem] border border-white/10 bg-[#08122f] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">Properties</p>
                    <button
                      type="button"
                      onClick={() => {
                        setRequiresPseudotimeOnly(false);
                        setDirectedOnly(false);
                        setSignedOnly(false);
                      }}
                      className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 transition hover:text-white"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="mt-4 space-y-3 text-sm text-slate-200">
                    <label className={`flex cursor-pointer items-center justify-between rounded-2xl border px-4 py-3 transition ${badgeClass(requiresPseudotimeOnly)}`}>
                      <span>Requires pseudotime</span>
                      <input
                        type="checkbox"
                        checked={requiresPseudotimeOnly}
                        onChange={(event) => setRequiresPseudotimeOnly(event.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-transparent"
                      />
                    </label>
                    <label className={`flex cursor-pointer items-center justify-between rounded-2xl border px-4 py-3 transition ${badgeClass(directedOnly)}`}>
                      <span>Directed output</span>
                      <input
                        type="checkbox"
                        checked={directedOnly}
                        onChange={(event) => setDirectedOnly(event.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-transparent"
                      />
                    </label>
                    <label className={`flex cursor-pointer items-center justify-between rounded-2xl border px-4 py-3 transition ${badgeClass(signedOnly)}`}>
                      <span>Signed output</span>
                      <input
                        type="checkbox"
                        checked={signedOnly}
                        onChange={(event) => setSignedOnly(event.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-transparent"
                      />
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            {filteredAlgorithms.map((algorithm) => {
              return (
                <button
                  key={algorithm.id}
                  type="button"
                  onClick={() => {
                    setClosingAlgorithmId(null);
                    setSelectedAlgorithmId(algorithm.id);
                  }}
                  className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5 text-left transition duration-200 hover:-translate-y-1 hover:border-teal-300/30 hover:bg-white/[0.06] hover:shadow-[0_0_0_1px_rgba(94,234,212,0.08),0_18px_48px_rgba(2,8,23,0.32)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-white">{algorithm.name}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{algorithm.tagline}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-300">
                      {algorithm.year}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200">
                      {algorithm.category}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-xs ${cardBadgeClass()}`}>
                      {algorithm.requiresPseudotime ? "Needs pseudotime" : "No pseudotime"}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-xs ${cardBadgeClass()}`}>
                      {algorithm.directed ? "Directed" : "Undirected"}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-xs ${cardBadgeClass()}`}>
                      {algorithm.signed ? "Signed" : "Unsigned"}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Publication</p>
                      <p className="mt-2 font-medium text-white">{algorithm.publication}</p>
                      <p className="mt-1 text-slate-400">{algorithm.journal}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Estimated runtime</p>
                      <p className="mt-2 font-medium text-white">{algorithm.runtime}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

      
      </section>

      {selectedAlgorithm ? (
        <div
          className={`${closingAlgorithmId ? "animate-modal-overlay-out" : "animate-modal-overlay"} fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/80 px-6 py-8 backdrop-blur-sm`}
          onClick={closeAlgorithmModal}
        >
          <div
            className={`${closingAlgorithmId ? "animate-modal-panel-out" : "animate-modal-panel"} max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] border border-white/10 bg-[#07122c] p-6 shadow-[0_32px_120px_rgba(0,0,0,0.45)] lg:p-8`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                  Algorithm details
                </p>
                <h2 className="mt-3 text-3xl font-semibold text-white">{selectedAlgorithm.name}</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-teal-300/30 bg-teal-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-teal-100">
                  {selectedAlgorithm.category}
                </span>
              </div>
            </div>

            <p className="mt-6 text-sm leading-7 text-slate-300">{selectedAlgorithm.detail}</p>

            <div className="mt-6 grid gap-3 text-sm text-slate-200 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Docker version</p>
                <p className="mt-2 font-medium text-white">{selectedAlgorithm.dockerVersion}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Properties</p>
                <p className="mt-2 text-slate-300">
                  {selectedAlgorithm.requiresPseudotime ? "Requires pseudotime" : "No pseudotime required"} · {selectedAlgorithm.directed ? "Directed" : "Undirected"} · {selectedAlgorithm.signed ? "Signed" : "Unsigned"}
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-6">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Strengths</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                  {selectedAlgorithm.strengths.map((item) => (
                    <li key={item} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Limitations</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                  {selectedAlgorithm.limitations.map((item) => (
                    <li key={item} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Recommended use cases</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                  {selectedAlgorithm.recommendedUseCases.map((item) => (
                    <li key={item} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={selectedAlgorithm.paperUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.08]"
              >
                Open paper
              </a>
              <a
                href={selectedAlgorithm.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-teal-300/30 bg-teal-300/10 px-4 py-3 text-sm font-medium text-teal-50 transition hover:bg-teal-300/15"
              >
                Open source repo
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}