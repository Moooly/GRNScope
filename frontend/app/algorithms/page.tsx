

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
  dockerVersion: string;
  paperUrl: string;
  strengths: string[];
  limitations: string[];
  recommendedUseCases: string[];
  detail: string;
};

const ALGORITHMS: AlgorithmEntry[] = [
  {
    id: "pidc",
    name: "PIDC",
    tagline: "Information-theory method for undirected GRN inference.",
    category: "Mutual information",
    requiresPseudotime: false,
    directed: false,
    signed: false,
    publication: "Chan et al.",
    year: "2017",
    journal: "Cell Systems",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1016/j.cels.2017.08.014",
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
    tagline: "Tree-based method for predicting regulators of target genes.",
    category: "Random forest",
    requiresPseudotime: false,
    directed: true,
    signed: false,
    publication: "Huynh-Thu et al.",
    year: "2010",
    journal: "PLoS One",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1371/journal.pone.0012776",
    strengths: [
      "Does not require pseudotime.",
      "Was one of the methods of choice highlighted by BEELINE.",
      "Showed good stability across repeated runs in the BEELINE analysis."
    ],
    limitations: [
      "Does not provide signed edges.",
      "Can be computationally heavier than GRNBoost2 on large gene sets."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a random-forest method."
  },
  {
    id: "grnboost2",
    name: "GRNBoost2",
    tagline: "Fast tree-based alternative to GENIE3.",
    category: "Random forest",
    requiresPseudotime: false,
    directed: true,
    signed: false,
    publication: "Moerman et al.",
    year: "2018",
    journal: "Bioinformatics",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/bty916",
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
    tagline: "Partial-correlation method for signed gene associations.",
    category: "Correlation",
    requiresPseudotime: false,
    directed: false,
    signed: true,
    publication: "Kim",
    year: "2015",
    journal: "Communications for Statistical Applications and Methods",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.5351/CSAM.2015.22.6.665",
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
    tagline: "ODE-based method for ordered single-cell data.",
    category: "ODE + regression",
    requiresPseudotime: true,
    directed: true,
    signed: true,
    publication: "Matsumoto et al.",
    year: "2017",
    journal: "Bioinformatics",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btx194",
    strengths: [
      "Produces directed edges.",
      "Produces signed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Requires ODE-related parameter settings.",
      "Was not among BEELINE's most consistently recommended methods."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as an ODE-based method."
  },
  {
    id: "sincerities",
    name: "SINCERITIES",
    tagline: "Regression method for time-ordered expression data.",
    category: "Regression",
    requiresPseudotime: true,
    directed: true,
    signed: true,
    publication: "Papili Gao et al.",
    year: "2018",
    journal: "Bioinformatics",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btx575",
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
    tagline: "Information-theory method for directed regulatory links.",
    category: "Mutual information",
    requiresPseudotime: true,
    directed: true,
    signed: false,
    publication: "Qiu et al.",
    year: "2018",
    journal: "bioRxiv preprint",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1101/426981",
    strengths: [
      "Produces directed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "May be sensitive to pseudotime quality.",
      "Does not provide signed edges."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a directed-information based method."
  },
  {
    id: "singe",
    name: "SINGE",
    tagline: "Granger-causality method for ordered single-cell data.",
    category: "Granger causality",
    requiresPseudotime: true,
    directed: true,
    signed: false,
    publication: "Deshpande et al.",
    year: "2019",
    journal: "bioRxiv preprint",
    dockerVersion: "0.4.1",
    paperUrl: "https://doi.org/10.1101/534834",
    strengths: [
      "Produces directed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "May be sensitive to pseudotime quality.",
      "Does not provide signed edges."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a Granger-causality based method."
  },
  {
    id: "leap",
    name: "LEAP",
    tagline: "Lagged-correlation method using pseudotime ordering.",
    category: "Correlation",
    requiresPseudotime: true,
    directed: true,
    signed: false,
    publication: "Specht and Li",
    year: "2017",
    journal: "Bioinformatics",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btw729",
    strengths: [
      "Produces directed edges.",
      "Fast in the BEELINE runtime comparison."
    ],
    limitations: [
      "Requires pseudotime-ordered cells.",
      "Uses lag-based correlation, so results depend on ordering quality.",
      "Does not provide signed edges."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a lag-based correlation method."
  },
  {
    id: "grisli",
    name: "GRISLI",
    tagline: "ODE-regression method for ordered single-cell data.",
    category: "ODE + regression",
    requiresPseudotime: true,
    directed: true,
    signed: false,
    publication: "Aubin-Frankowski and Vert",
    year: "2018",
    journal: "bioRxiv preprint",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1101/464479",
    strengths: [
      "Produces directed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Requires regression-related parameter settings.",
      "Does not provide signed edges."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as an ODE and regression based method."
  },
  {
    id: "grnvbem",
    name: "GRNVBEM",
    tagline: "Variational Bayesian method for directed signed GRNs.",
    category: "Regression",
    requiresPseudotime: true,
    directed: true,
    signed: true,
    publication: "Sanchez-Castillo et al.",
    year: "2018",
    journal: "Bioinformatics",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btx524",
    strengths: [
      "Produces directed edges.",
      "Produces signed edges."
    ],
    limitations: [
      "Requires time-ordered or pseudotime-ordered cells.",
      "Can be computationally expensive for larger gene sets.",
      "Was not among BEELINE's most consistently recommended methods."
    ],
    recommendedUseCases: [],
    detail:
      "Included in the BEELINE benchmark as a regression-based method."
  },
  {
    id: "scns",
    name: "SCNS",
    tagline: "Boolean-model method for time-course single-cell data.",
    category: "Boolean model",
    requiresPseudotime: true,
    directed: true,
    signed: true,
    publication: "Woodhouse et al.",
    year: "2018",
    journal: "BMC Systems Biology",
    dockerVersion: "base",
    paperUrl: "https://doi.org/10.1186/s12918-018-0581-1",
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
    ? "border-[#1b75a6]/25 bg-[#e9f5fa] text-[#1b75a6]"
    : "border-slate-200 bg-white text-slate-600";
}

function cardBadgeClass() {
  return "border-slate-200 bg-white text-slate-600";
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
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="relative overflow-hidden bg-[#f4f6f8]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/90 to-transparent" />
        <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-cyan-100/60 blur-3xl" />
        <div className="absolute -right-24 top-12 h-72 w-72 rounded-full bg-teal-100/60 blur-3xl" />
        <div className="relative mx-auto max-w-[1180px] px-6 py-16 lg:px-10 lg:py-20">
          <div className="flex flex-col gap-6">
            <div className="max-w-4xl">
              <p className="text-sm font-bold uppercase tracking-[0.28em] text-[#1b75a6]">
                Algorithms directory
              </p>
              <h1 className="mt-4 text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-[4.15rem] lg:leading-[1.02]">
                Explore algorithms in GRNScope
              </h1>
              <p className="mt-6 max-w-3xl text-[1.05rem] leading-8 text-slate-700">
                Browse the gene regulatory network inference methods available in the platform.
                Filter by methodology, pseudotime requirements, directionality, and signed output.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-[1180px] px-6 py-10 lg:px-10 lg:py-12">

        <div className="space-y-4">
          <div className="flex flex-col gap-4 border-b border-[#213f54]/35 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-950">All algorithms</h2>
              <p className="mt-1 text-sm text-slate-600">
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
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition ${
                  isMethodologyMenuOpen || selectedCategories.length > 0
                    ? "border-[#1b75a6]/25 bg-[#e9f5fa] text-[#1b75a6]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
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
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition ${
                  isPropertiesMenuOpen || requiresPseudotimeOnly || directedOnly || signedOnly
                    ? "border-[#1b75a6]/25 bg-[#e9f5fa] text-[#1b75a6]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
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
                  className="absolute right-0 top-full z-20 mt-3 w-[320px] rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-slate-950">Methodology</p>
                    <button
                      type="button"
                      onClick={() => setSelectedCategories([])}
                      className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 transition hover:text-[#1b75a6]"
                    >
                      Select all
                    </button>
                  </div>
                  <div className="mt-4 space-y-3 text-sm text-slate-700">
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
                  className="absolute right-0 top-full z-20 mt-3 w-[320px] rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-slate-950">Properties</p>
                    <button
                      type="button"
                      onClick={() => {
                        setRequiresPseudotimeOnly(false);
                        setDirectedOnly(false);
                        setSignedOnly(false);
                      }}
                      className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 transition hover:text-[#1b75a6]"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="mt-4 space-y-3 text-sm text-slate-700">
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

          <div className="grid gap-5 xl:grid-cols-3">
            {filteredAlgorithms.map((algorithm) => {
              return (
                <button
                  key={algorithm.id}
                  type="button"
                  onClick={() => {
                    setClosingAlgorithmId(null);
                    setSelectedAlgorithmId(algorithm.id);
                  }}
                  className="group flex min-h-[12.5rem] flex-col rounded-[1.5rem] border border-slate-200 bg-white p-6 text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:border-[#1b75a6]/25 hover:shadow-xl hover:shadow-slate-200/70"
                >
                  <div className="flex flex-1 flex-col">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-2xl font-bold tracking-tight text-slate-950">
                          {algorithm.name}
                        </h3>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                          {algorithm.tagline}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {algorithm.year}
                      </span>
                    </div>

                    <div className="mt-auto pt-5">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div>
                          <div>
                            <p className="text-[0.66rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                              Methodology
                            </p>
                            <p className="mt-1 text-sm font-bold text-[#1b75a6]">
                              {algorithm.category}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium leading-none ${cardBadgeClass()}`}>
                          {algorithm.requiresPseudotime ? "Uses pseudotime" : "No pseudotime"}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium leading-none ${cardBadgeClass()}`}>
                          {algorithm.directed ? "Directed" : "Undirected"}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium leading-none ${cardBadgeClass()}`}>
                          {algorithm.signed ? "Signed" : "Unsigned"}
                        </span>
                      </div>
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
          className={`${closingAlgorithmId ? "animate-modal-overlay-out" : "animate-modal-overlay"} fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 pb-8 pt-28 backdrop-blur-sm sm:px-6 lg:pb-12 lg:pt-32`}
          onClick={closeAlgorithmModal}
        >
          <div
            className={`${closingAlgorithmId ? "animate-modal-panel-out" : "animate-modal-panel"} mb-8 w-full max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/20 lg:mb-12 lg:p-8`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                  Algorithm details
                </p>
                <h2 className="mt-3 text-3xl font-bold text-slate-950">{selectedAlgorithm.name}</h2>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[#1b75a6]">
                  {selectedAlgorithm.category}
                </span>
              </div>
            </div>

            <p className="mt-6 text-sm leading-7 text-slate-600">{selectedAlgorithm.detail}</p>

            <div className="mt-6 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Publication</p>
                <p className="mt-2 font-semibold text-slate-950">{selectedAlgorithm.publication}</p>
                <p className="mt-1 text-slate-500">{selectedAlgorithm.journal}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Docker version</p>
                <p className="mt-2 font-semibold text-slate-950">{selectedAlgorithm.dockerVersion}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Properties</p>
                <p className="mt-2 text-slate-600">
                  {selectedAlgorithm.requiresPseudotime ? "Requires pseudotime" : "No pseudotime required"} · {selectedAlgorithm.directed ? "Directed" : "Undirected"} · {selectedAlgorithm.signed ? "Signed" : "Unsigned"}
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-6">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Strengths</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  {selectedAlgorithm.strengths.map((item) => (
                    <li key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Limitations</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  {selectedAlgorithm.limitations.map((item) => (
                    <li key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
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
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
              >
                Open paper
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}