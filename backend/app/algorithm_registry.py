# backend/app/algorithm_registry.py

from __future__ import annotations

from typing import Any, Literal, TypedDict


AlgorithmCategory = Literal[
    "Mutual information",
    "Random forest",
    "Correlation",
    "ODE + regression",
    "Regression",
    "Granger causality",
    "Tree-based dynamical system",
    "Graph learning",
    "Prior-informed regression",
]


class AlgorithmParameter(TypedDict, total=False):
    name: str
    label: str
    description: str
    default: Any
    required: bool
    value_type: str
    options: list[Any]
    # Optional inclusive bounds for numeric parameters. When present they are
    # enforced server-side and can be read by the frontend to bound the input
    # control. Invalid values are rejected rather than silently changed.
    minimum: float
    maximum: float
    # UI hints (not enforced server-side). 'step' is the numeric input
    # increment; when absent the frontend uses 1 for integers. 'advanced' marks
    # rarely-tuned parameters the settings modal groups under an "Advanced"
    # section that is collapsed by default.
    step: float
    advanced: bool


class AlgorithmInfo(TypedDict):
    id: str
    name: str
    description: str
    long_description: str
    category: AlgorithmCategory
    year: str
    journal: str
    publication_title: str
    publication_url: str
    source_url: str | None
    docker_image: str
    runner: str
    directed: bool
    signed: bool
    requires_pseudotime: bool
    supports_expression_matrix: bool
    active: bool
    recommended: bool
    estimated_runtime: str
    strengths: list[str]
    limitations: list[str]
    recommended_use_cases: list[str]
    parameters: list[AlgorithmParameter]


CELLORACLE_SPECIES_OPTIONS: list[str] = [
    "human",
    "mouse",
    "rat",
    "pig",
    "chicken",
    "zebrafish",
    "xenopus_tropicalis",
    "drosophila",
    "c_elegans",
    "s_cerevisiae",
]

CELLORACLE_BASE_GRN_OPTIONS: list[str] = [
    "auto",
    "mouse_scATAC_atlas",
    "promoter",
]


ALGORITHMS: list[AlgorithmInfo] = [
    {
        "id": "PIDC",
        "name": "PIDC",
        "description": "Information-theory method for undirected GRN inference.",
        "long_description": (
            "PIDC uses multivariate information measures to infer statistical dependency "
            "relationships between genes from single-cell expression data."
        ),
        "category": "Mutual information",
        "year": "2017",
        "journal": "Cell Systems",
        "publication_title": "Gene regulatory network inference from single-cell data using multivariate information measures",
        "publication_url": "https://doi.org/10.1016/j.cels.2017.08.014",
        "source_url": None,
        "docker_image": "grnbeeline/pidc:base",
        "runner": "BLRun/pidcRunner.py",
        "directed": False,
        "signed": False,
        "requires_pseudotime": False,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": True,
        "estimated_runtime": "Slow for large gene sets",
        "strengths": [
            "Recommended by the BEELINE paper as one of the strongest methods.",
            "Does not require pseudotime.",
            "Showed strong accuracy on curated and experimental datasets.",
        ],
        "limitations": [
            "Produces undirected and unsigned edges.",
            "Can be computationally expensive on larger gene sets.",
        ],
        "recommended_use_cases": [
            "General-purpose GRN inference.",
            "Datasets without pseudotime.",
            "Recommended preset selection.",
        ],
        "parameters": [],
    },
    {
        "id": "GENIE3",
        "name": "GENIE3",
        "description": "Tree-based method for predicting regulators of target genes.",
        "long_description": (
            "GENIE3 predicts the expression of each target gene from candidate regulators "
            "using tree-based ensemble models and uses feature importance as edge weight."
        ),
        "category": "Random forest",
        "year": "2010",
        "journal": "PLoS One",
        "publication_title": "Inferring regulatory networks from expression data using tree-based methods",
        "publication_url": "https://doi.org/10.1371/journal.pone.0012776",
        "source_url": None,
        "docker_image": "grnbeeline/arboreto:base",
        "runner": "BLRun/genie3Runner.py",
        "directed": True,
        "signed": False,
        "requires_pseudotime": False,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": True,
        "estimated_runtime": "Medium to slow",
        "strengths": [
            "Recommended by the BEELINE paper as one of the strongest methods.",
            "Does not require pseudotime.",
            "Produces directed regulator-target predictions.",
        ],
        "limitations": [
            "Does not infer activation versus repression sign.",
            "May be slow for large gene sets.",
        ],
        "recommended_use_cases": [
            "General-purpose GRN inference.",
            "Datasets without pseudotime.",
            "Recommended preset selection.",
        ],
        "parameters": [
            {
                "name": "nEstimators",
                "label": "Number of trees",
                "description": (
                    "Number of trees in the random forest. More trees give more "
                    "stable edge rankings but increase runtime roughly linearly."
                ),
                "default": 400,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 2000,
                "step": 50,
            },
            {
                "name": "maxFeatures",
                "label": "Candidate regulators per split",
                "description": (
                    "Candidate regulators considered at each tree split. 'sqrt' "
                    "and 'log2' add randomness and speed; 'all' considers every gene."
                ),
                "default": "sqrt",
                "required": False,
                "value_type": "string",
                "options": ["sqrt", "log2", "all"],
            },
        ],
    },
    {
        "id": "GRNBOOST2",
        "name": "GRNBOOST2",
        "description": "Fast tree-based alternative to GENIE3.",
        "long_description": (
            "GRNBoost2 uses gradient-boosted tree models through Arboreto to infer "
            "regulatory links efficiently from expression data."
        ),
        "category": "Random forest",
        "year": "2018",
        "journal": "Bioinformatics",
        "publication_title": "GRNBoost2 and Arboreto: efficient and scalable inference of gene regulatory networks",
        "publication_url": "https://doi.org/10.1093/bioinformatics/bty916",
        "source_url": "https://github.com/aertslab/arboreto",
        "docker_image": "grnbeeline/arboreto:base",
        "runner": "BLRun/grnboost2Runner.py",
        "directed": True,
        "signed": False,
        "requires_pseudotime": False,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": True,
        "estimated_runtime": "Medium",
        "strengths": [
            "Recommended by the BEELINE paper as one of the strongest methods.",
            "Does not require pseudotime.",
            "More scalable than GENIE3 in many cases.",
        ],
        "limitations": [
            "Does not infer activation versus repression sign.",
        ],
        "recommended_use_cases": [
            "General-purpose GRN inference.",
            "Large expression matrices.",
            "Recommended preset selection.",
        ],
        "parameters": [
            {
                "name": "learningRate",
                "label": "Learning rate",
                "description": (
                    "Boosting shrinkage. Lower values are more accurate but "
                    "converge more slowly."
                ),
                "default": 0.01,
                "required": False,
                "value_type": "float",
                "minimum": 0.0001,
                "maximum": 1.0,
                "step": 0.001,
            },
            {
                "name": "nEstimators",
                "label": "Max boosting rounds",
                "description": (
                    "Upper bound on boosting rounds. Early stopping usually halts "
                    "well before this cap is reached."
                ),
                "default": 5000,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 20000,
                "step": 100,
                "advanced": True,
            },
            {
                "name": "maxFeatures",
                "label": "Regulators sampled per round",
                "description": (
                    "Fraction of candidate regulators sampled per boosting round, "
                    "between 0 and 1."
                ),
                "default": 0.1,
                "required": False,
                "value_type": "float",
                "minimum": 0.01,
                "maximum": 1.0,
                "step": 0.05,
                "advanced": True,
            },
        ],
    },
    {
        "id": "CELLORACLE",
        "name": "CELLORACLE",
        "description": "Prior-informed GRN construction using promoter or atlas base-GRN candidates.",
        "long_description": (
            "CellOracle combines a TF-target base GRN with single-cell expression "
            "data to estimate directed, signed regulatory links. GRNScope runs it "
            "globally, and also per cluster when cluster labels are uploaded."
        ),
        "category": "Prior-informed regression",
        "year": "2022",
        "journal": "Nature",
        "publication_title": "CellOracle: dissecting cell identity by network biology",
        "publication_url": "https://doi.org/10.1038/s41586-022-05688-9",
        "source_url": "https://github.com/morris-lab/CellOracle",
        "docker_image": "grnbeeline/celloracle:base",
        "runner": "BLRun/celloracleRunner.py",
        "directed": True,
        "signed": True,
        "requires_pseudotime": False,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Slow for large gene or cell sets",
        "strengths": [
            "Uses prior TF-target candidates instead of testing every possible gene pair.",
            "Produces directed and signed regulatory coefficients.",
            "Supports global and per-cluster network construction.",
        ],
        "limitations": [
            "Requires a species-specific base GRN prior.",
            "Very large datasets may require stronger gene or cell downsampling.",
            "Cluster-specific networks are only available when cluster labels are uploaded.",
        ],
        "recommended_use_cases": [
            "Prior-informed regulatory network construction.",
            "Comparing global and cluster-specific regulation.",
            "Signed TF-target interpretation.",
        ],
        # 'species' and 'base_grn' are chosen in the CellOracle config modal
        # (project manifest -> runtime params), not here, to avoid a duplicate
        # control. The per-target edge cap is the shared 'maxRegulatorsPerTarget'
        # setting rather than a CellOracle-specific 'topK'.
        "parameters": [
            {
                "name": "maxCells",
                "label": "Max cells per network",
                "description": "Maximum number of cells per CellOracle scope.",
                "default": 30000,
                "required": False,
                "value_type": "integer",
                "minimum": 1,
                "maximum": 200000,
                "step": 1000,
            },
            # 'minClusterCells' is intentionally not exposed here: the minimum
            # cluster size is a platform-wide gate (MIN_CLUSTER_SCOPE_CELLS in
            # job_service.py) applied when defining cluster scopes for every
            # algorithm, not a CellOracle run parameter.
            {
                "name": "pValueCutoff",
                "label": "P-value cutoff",
                "description": "CellOracle links above this p-value are removed when p-values are available.",
                "default": 0.05,
                "required": False,
                "value_type": "float",
                "minimum": 0.0,
                "maximum": 1.0,
                "step": 0.01,
            },
        ],
    },
    {
        "id": "PPCOR",
        "name": "PPCOR",
        "description": "Partial-correlation method for signed gene associations.",
        "long_description": (
            "PPCOR computes partial correlations between genes while conditioning on "
            "other genes. The result is an association-based network rather than a "
            "causal regulatory network."
        ),
        "category": "Correlation",
        "year": "2015",
        "journal": "Communications for Statistical Applications and Methods",
        "publication_title": "ppcor: An R package for a fast calculation to semi-partial correlation coefficients",
        "publication_url": "https://doi.org/10.5351/CSAM.2015.22.6.665",
        "source_url": "https://cran.r-project.org/package=ppcor",
        "docker_image": "grnbeeline/ppcor:base",
        "runner": "BLRun/ppcorRunner.py",
        "directed": False,
        "signed": True,
        "requires_pseudotime": False,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Fast",
        "strengths": [
            "Fast correlation-based baseline.",
            "Can produce signed associations.",
            "Does not require pseudotime.",
        ],
        "limitations": [
            "Edges are undirected.",
            "Correlation does not prove direct regulation.",
        ],
        "recommended_use_cases": [
            "Fast baseline comparison.",
            "Signed association exploration.",
        ],
        "parameters": [
            {
                "name": "pVal",
                "label": "P-value cutoff",
                "description": "P-value cutoff used by PPCOR.",
                "default": 0.01,
                "required": False,
                "value_type": "float",
                "minimum": 0.0,
                "maximum": 1.0,
                "step": 0.01,
            }
        ],
    },
    {
        "id": "PEARSON",
        "name": "PEARSON",
        "description": "Simple Pearson-correlation baseline for gene-gene association.",
        "long_description": (
            "Pearson computes pairwise linear correlations between gene expression "
            "profiles. In this platform, it is treated as a simple BEELINE baseline "
            "for gene-gene association, not as a dedicated GRN inference method."
        ),
        "category": "Correlation",
        "year": "Baseline",
        "journal": "Pearson correlation",
        "publication_title": "Pairwise Pearson correlation baseline",
        "publication_url": "https://murali-group.github.io/Beeline/BLRun.html",
        "source_url": None,
        "docker_image": "local",
        "runner": "BLRun/pearsonRunner.py",
        "directed": False,
        "signed": True,
        "requires_pseudotime": False,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Fast",
        "strengths": [
            "Very fast baseline method based on Pearson correlation.",
            "Easy to interpret as pairwise linear association.",
            "Does not require pseudotime.",
        ],
        "limitations": [
            "Undirected association only.",
            "Only captures linear relationships.",
            "It is a BEELINE baseline association method rather than a dedicated GRN inference algorithm.",
            "Correlation does not prove direct regulation.",
        ],
        "recommended_use_cases": [
            "Quick baseline comparison.",
            "Testing the pipeline with a lightweight local method.",
        ],
        # No algorithm-specific parameters: the per-target edge cap is the
        # shared 'maxRegulatorsPerTarget' setting, applied to every algorithm.
        "parameters": [],
    },
    {
        "id": "SCODE",
        "name": "SCODE",
        "description": "ODE-based method for ordered single-cell data.",
        "long_description": (
            "SCODE models gene expression dynamics using linear ordinary differential "
            "equations and low-dimensional latent variables."
        ),
        "category": "ODE + regression",
        "year": "2017",
        "journal": "Bioinformatics",
        "publication_title": "SCODE: an efficient regulatory network inference algorithm from single-cell RNA-Seq during differentiation",
        "publication_url": "https://doi.org/10.1093/bioinformatics/btx194",
        "source_url": None,
        "docker_image": "grnbeeline/scode:base",
        "runner": "BLRun/scodeRunner.py",
        "directed": True,
        "signed": True,
        "requires_pseudotime": True,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Fast to medium",
        "strengths": [
            "Can infer directed and signed edges.",
            "Designed for differentiation-style single-cell data.",
        ],
        "limitations": [
            "Requires ordered cells or pseudotime.",
            "Performance can depend on pseudotime quality.",
        ],
        "recommended_use_cases": [
            "Datasets with reliable pseudotime.",
            "Exploring signed regulatory direction.",
        ],
        "parameters": [
            {
                "name": "z",
                "label": "Latent dimension (z)",
                "description": "Latent dimension used by SCODE (canonical paper value is 4).",
                "default": 4,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 100,
            },
            {
                "name": "nIter",
                "label": "Number of iterations",
                "description": "Number of optimization iterations.",
                "default": 1000,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 20000,
                "step": 100,
            },
            {
                "name": "nRep",
                "label": "Number of repeats",
                "description": "Number of repeated SCODE runs averaged for the final network.",
                "default": 3,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 20,
            },
        ],
    },
    {
        "id": "SINCERITIES",
        "name": "SINCERITIES",
        "description": "Regression method for time-ordered expression data.",
        "long_description": (
            "SINCERITIES infers regulatory relationships from time-stamped or "
            "pseudotime-ordered single-cell expression profiles."
        ),
        "category": "Regression",
        "year": "2018",
        "journal": "Bioinformatics",
        "publication_title": "SINCERITIES: inferring gene regulatory networks from time-stamped single cell transcriptional expression profiles",
        "publication_url": "https://doi.org/10.1093/bioinformatics/btx575",
        "source_url": None,
        "docker_image": "grnbeeline/sincerities:base",
        "runner": "BLRun/sinceritiesRunner.py",
        "directed": True,
        "signed": True,
        "requires_pseudotime": True,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Slow for large gene sets",
        "strengths": [
            "Designed for time-stamped single-cell expression data.",
            "Can infer directed and signed edges.",
        ],
        "limitations": [
            "Requires time ordering or pseudotime.",
            "BEELINE reported sensitivity to pseudotime quality.",
        ],
        "recommended_use_cases": [
            "Datasets with reliable temporal ordering.",
            "Differentiation trajectory analysis.",
        ],
        "parameters": [
            {
                "name": "nBins",
                "label": "Number of time bins",
                "description": "Time windows the trajectory is split into.",
                "default": 10,
                "required": False,
                "value_type": "int",
                "minimum": 2,
                "maximum": 100,
            },
        ],
    },
    {
        "id": "SCRIBE",
        "name": "SCRIBE",
        "description": "Information-theory method for directed regulatory links.",
        "long_description": (
            "SCRIBE uses restricted directed information to estimate causal regulatory "
            "interactions between genes from coupled single-cell expression dynamics."
        ),
        "category": "Mutual information",
        "year": "2020",
        "journal": "Cell Systems",
        "publication_title": "Inferring Causal Gene Regulatory Networks from Coupled Single-Cell Expression Dynamics Using Scribe",
        "publication_url": "https://doi.org/10.1016/j.cels.2020.02.003",
        "source_url": "https://github.com/aristoteleo/Scribe-py",
        "docker_image": "grnbeeline/scribe:base",
        "runner": "BLRun/scribeRunner.py",
        "directed": True,
        "signed": False,
        "requires_pseudotime": True,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Slow",
        "strengths": [
            "Infers directed relationships.",
            "Supports different restricted directed information variants.",
        ],
        "limitations": [
            "Requires careful parameter choice.",
            "Can be slow.",
            "Performance can depend on pseudotime quality.",
        ],
        "recommended_use_cases": [
            "Advanced analysis with pseudotime.",
            "Comparing directed information methods.",
        ],
        "parameters": [
            {
                "name": "delay",
                "label": "Time delay",
                "description": "Lag between regulator and target expression.",
                "default": 5,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 100,
                "advanced": True,
            },
            {
                "name": "method",
                "label": "RDI variant",
                "description": "Restricted directed information variant.",
                "default": "ucRDI",
                "required": False,
                "value_type": "string",
                "options": ["RDI", "uRDI", "cRDI", "ucRDI"],
            },
            {
                "name": "lowerDetectionLimit",
                "label": "Lower detection limit",
                "description": "Lower expression detection limit.",
                "default": 0,
                "required": False,
                "value_type": "float",
                "step": 0.1,
                "advanced": True,
            },
            {
                "name": "expressionFamily",
                "label": "Expression distribution",
                "description": "Distribution family for expression values.",
                "default": "uninormal",
                "required": False,
                "value_type": "string",
                "options": ["uninormal", "negbinomial"],
            },
            {
                "name": "log",
                "label": "Log-transform expression",
                "description": "Whether SCRIBE should log-transform expression values.",
                "default": False,
                "required": False,
                "value_type": "bool",
                "advanced": True,
            },
            {
                "name": "ignorePT",
                "label": "Ignore pseudotime",
                "description": "Whether SCRIBE ignores pseudotime.",
                "default": True,
                "required": False,
                "value_type": "bool",
            },
        ],
    },
    {
        "id": "SINGE",
        "name": "SINGE",
        "description": "Granger-causality ensemble method for ordered single-cell data.",
        "long_description": (
            "SINGE uses kernel-based Granger causality regression and ensemble "
            "aggregation to infer directed regulatory relationships from ordered "
            "single-cell transcriptomic data."
        ),
        "category": "Granger causality",
        "year": "2022",
        "journal": "Cell Reports",
        "publication_title": "Network inference with Granger causality ensembles on single-cell transcriptomics",
        "publication_url": "https://doi.org/10.1016/j.celrep.2022.110333",
        "source_url": "https://github.com/gitter-lab/SINGE",
        "docker_image": "grnbeeline/singe:0.4.1",
        "runner": "BLRun/singeRunner.py",
        "directed": True,
        "signed": False,
        "requires_pseudotime": True,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Very slow",
        "strengths": [
            "Infers directed relationships.",
            "Designed for ordered single-cell expression data.",
        ],
        "limitations": [
            "Can be computationally expensive.",
            "Requires pseudotime or temporal ordering.",
            "Performance can depend on pseudotime quality.",
        ],
        "recommended_use_cases": [
            "Advanced pseudotime-based analysis.",
            "Small to medium gene sets where runtime is acceptable.",
        ],
        "parameters": [
            {
                "name": "lambda",
                "label": "Regularization strength",
                "description": "Higher values give sparser, more conservative networks.",
                "default": 0.01,
                "required": False,
                "value_type": "float",
                "minimum": 0.0,
                "maximum": 10.0,
                "step": 0.01,
            },
            {
                "name": "dT",
                "label": "Time resolution (ΔT)",
                "description": "Spacing of the resampled time grid.",
                "default": 15,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 1000,
                "advanced": True,
            },
            {
                "name": "num_lags",
                "label": "Number of lags",
                "description": "Past time points used to predict the present.",
                "default": 5,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 50,
                "advanced": True,
            },
            {
                "name": "kernel_width",
                "label": "Kernel width (smoothing)",
                "description": "Temporal smoothing bandwidth.",
                "default": 0.5,
                "required": False,
                "value_type": "float",
                "minimum": 0.0,
                "maximum": 100.0,
                "step": 0.1,
                "advanced": True,
            },
            {
                "name": "prob_zero_removal",
                "label": "Zero-removal probability",
                "description": "Chance a zero is dropped per replicate (0–1).",
                "default": 0,
                "required": False,
                "value_type": "float",
                "minimum": 0.0,
                "maximum": 1.0,
                "step": 0.05,
                "advanced": True,
            },
            {
                "name": "prob_remove_samples",
                "label": "Sample-removal probability",
                "description": "Chance a cell is dropped per replicate (0–1).",
                "default": 0.0,
                "required": False,
                "value_type": "float",
                "minimum": 0.0,
                "maximum": 1.0,
                "step": 0.05,
                "advanced": True,
            },
            {
                "name": "family",
                "label": "Expression distribution",
                "description": (
                    "Gaussian is recommended for normalized or log-transformed data. "
                    "Poisson is intended for raw count data and may require more memory."
                ),
                "default": "gaussian",
                "required": False,
                "value_type": "string",
                "options": ["gaussian", "poisson"],
                "advanced": True,
            },
            {
                "name": "num_replicates",
                "label": "Number of replicates",
                "description": "Number of SINGE ensemble replicates aggregated for the final network.",
                "default": 3,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 20,
            },
        ],
    },
    {
        "id": "LEAP",
        "name": "LEAP",
        "description": "Lagged-correlation method using pseudotime ordering.",
        "long_description": (
            "LEAP constructs gene co-expression networks using pseudotime ordering "
            "and lagged correlation relationships."
        ),
        "category": "Correlation",
        "year": "2017",
        "journal": "Bioinformatics",
        "publication_title": "LEAP: constructing gene co-expression networks for single-cell RNA-sequencing data using pseudotime ordering",
        "publication_url": "https://doi.org/10.1093/bioinformatics/btw729",
        "source_url": None,
        "docker_image": "grnbeeline/leap:base",
        "runner": "BLRun/leapRunner.py",
        "directed": True,
        "signed": False,
        "requires_pseudotime": True,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Fast",
        "strengths": [
            "Fast pseudotime-based correlation method.",
            "Can infer direction from lagged relationships.",
        ],
        "limitations": [
            "Requires pseudotime.",
            "Correlation-based result should not be treated as confirmed regulation.",
        ],
        "recommended_use_cases": [
            "Fast pseudotime-based baseline.",
            "Trajectory-based datasets.",
        ],
        "parameters": [
            {
                "name": "maxLag",
                "label": "Maximum lag",
                "description": "Maximum lag used by LEAP.",
                "default": 0.33,
                "required": False,
                "value_type": "float",
                "minimum": 0.0,
                "maximum": 1.0,
                "step": 0.01,
            }
        ],
    },
    {
        "id": "GRISLI",
        "name": "GRISLI",
        "description": "ODE-regression method for ordered single-cell data.",
        "long_description": (
            "GRISLI infers regulatory networks from single-cell data using linear "
            "differential equations and velocity information."
        ),
        "category": "ODE + regression",
        "year": "2018",
        "journal": "bioRxiv preprint",
        "publication_title": "Gene regulation inference from single-cell RNA-seq data with linear differential equations and velocity inference",
        "publication_url": "https://doi.org/10.1101/464479",
        "source_url": None,
        "docker_image": "grnbeeline/grisli:base",
        "runner": "BLRun/grisliRunner.py",
        "directed": True,
        "signed": False,
        "requires_pseudotime": True,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Slow for large gene or cell sets",
        "strengths": [
            "ODE-based dynamic modeling approach.",
            "Designed for ordered single-cell data.",
        ],
        "limitations": [
            "Requires pseudotime or ordering information.",
            "Does not infer activation versus repression sign in this registry.",
        ],
        "recommended_use_cases": [
            "Trajectory-based datasets.",
            "Comparing ODE-based methods.",
        ],
        "parameters": [
            {
                "name": "L",
                "label": "L",
                "description": "GRISLI L parameter.",
                "default": 10,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 100,
            },
            {
                "name": "R",
                "label": "Stability iterations",
                "description": "Resampling rounds for stability selection.",
                "default": 1000,
                "required": False,
                "value_type": "int",
                "minimum": 1,
                "maximum": 20000,
                "step": 100,
            },
            {
                "name": "alphaMin",
                "label": "Minimum alpha",
                "description": "Minimum regularization value (alpha) used by GRISLI.",
                "default": 0.0,
                "required": False,
                "value_type": "float",
                "minimum": 0.0,
                "maximum": 1.0,
                "step": 0.01,
            },
        ],
    },
    {
        "id": "GRNVBEM",
        "name": "GRNVBEM",
        "description": "Variational Bayesian method for directed signed GRNs.",
        "long_description": (
            "GRNVBEM uses a first-order autoregressive moving-average model within "
            "a variational Bayesian expectation-maximization framework to infer gene "
            "regulatory networks from time-series or pseudo-time-series data."
        ),
        "category": "Regression",
        "year": "2018",
        "journal": "Bioinformatics",
        "publication_title": "A Bayesian framework for the inference of gene regulatory networks from time and pseudo-time series data",
        "publication_url": "https://doi.org/10.1093/bioinformatics/btx605",
        "source_url": "https://github.com/mscastillo/GRNVBEM",
        "docker_image": "grnbeeline/grnvbem:base",
        "runner": "BLRun/grnvbemRunner.py",
        "directed": True,
        "signed": True,
        "requires_pseudotime": True,
        "supports_expression_matrix": True,
        "active": True,
        "recommended": False,
        "estimated_runtime": "Slow for large gene sets",
        "strengths": [
            "Bayesian modeling approach.",
            "Can infer directed and signed edges.",
        ],
        "limitations": [
            "Requires pseudotime or ordered data.",
            "Can be computationally expensive.",
        ],
        "recommended_use_cases": [
            "Trajectory-based datasets.",
            "Comparing Bayesian GRN inference methods.",
        ],
        "parameters": [],
    },
    {
        "id": "JUMP3",
        "name": "JUMP3",
        "description": "Hybrid dynamical-model and tree-based method for time-series GRN inference.",
        "long_description": (
            "Jump3 combines a formal dynamical model of gene expression with "
            "non-parametric decision-tree reconstruction. It uses time-series expression "
            "data to rank directed regulatory links."
        ),
        "category": "Tree-based dynamical system",
        "year": "2015",
        "journal": "Bioinformatics",
        "publication_title": "Combining tree-based and dynamical systems for the inference of gene regulatory networks",
        "publication_url": "https://doi.org/10.1093/bioinformatics/btv401",
        "source_url": "https://github.com/vahuynh/Jump3",
        "docker_image": "jump3:base",
        "runner": "BLRun/jump3Runner.py",
        "directed": True,
        "signed": False,
        "requires_pseudotime": True,
        "supports_expression_matrix": True,
        "active": False,
        "recommended": False,
        "estimated_runtime": "Medium",
        "strengths": [
            "Combines a biologically motivated dynamical model with flexible tree-based reconstruction.",
            "Produces directed regulator-target predictions.",
            "Can rank candidate regulatory links from time-series expression data.",
        ],
        "limitations": [
            "Requires time-series or ordered data.",
            "Not one of the 12 algorithms evaluated in the original BEELINE paper.",
            "Docker image is listed as a local-style image in the BEELINE repo.",
            "Does not provide activation versus repression signs in this registry.",
        ],
        "recommended_use_cases": [
            "Advanced comparison with dynamic methods.",
            "Datasets with reliable pseudotime.",
        ],
        "parameters": [],
    },
    {
        "id": "SCSGL",
        "name": "SCSGL",
        "description": "Kernelized signed graph-learning method that requires a ground-truth network file.",
        "long_description": (
            "scSGL learns signed gene regulatory networks from single-cell expression "
            "data using graph signal processing. Its kernelized version is designed "
            "to model non-linear co-expression and handle many zero values in scRNA-seq data."
        ),
        "category": "Graph learning",
        "year": "2022",
        "journal": "Bioinformatics",
        "publication_title": "scSGL: kernelized signed graph learning for single-cell gene regulatory network inference",
        "publication_url": "https://doi.org/10.1093/bioinformatics/btac288",
        "source_url": "https://github.com/Single-Cell-Graph-Learning/scSGL",
        "docker_image": "scsgl:base",
        "runner": "BLRun/scsglRunner.py",
        "directed": False,
        "signed": True,
        "requires_pseudotime": False,
        "supports_expression_matrix": True,
        "active": False,
        "recommended": False,
        "estimated_runtime": "Medium",
        "strengths": [
            "Learns signed networks with positive and negative regulatory associations.",
            "Designed for single-cell expression data.",
            "Kernelized version accounts for non-linear co-expression and frequent zero values.",
        ],
        "limitations": [
            "Requires a ground-truth network file named GroundTruthNetwork.csv.",
            "Edges are not directed in this registry.",
            "Requires positive-density, negative-density, and association-measure parameters.",
            "May require careful parameter tuning for different datasets.",
        ],
        "recommended_use_cases": [
            "Signed network exploration.",
            "Comparison with correlation and graphical-model methods.",
        ],
        "parameters": [
            {
                "name": "pos_density",
                "label": "Positive edge density",
                "description": "Density of positive edges in the inferred network.",
                "default": None,
                "required": True,
                "value_type": "float",
            },
            {
                "name": "neg_density",
                "label": "Negative edge density",
                "description": "Density of negative edges in the inferred network.",
                "default": None,
                "required": True,
                "value_type": "float",
            },
            {
                "name": "assoc",
                "label": "Association measure",
                "description": "Association measure used for graph learning.",
                "default": None,
                "required": True,
                "value_type": "string",
            },
        ],
    },
]


RECOMMENDED_ALGORITHM_IDS: list[str] = [
    "PIDC",
    "GENIE3",
    "GRNBOOST2",
]

ALGORITHM_RUN_DIFFICULTY_ORDER: list[str] = [
    "PEARSON",
    "PPCOR",
    "LEAP",
    "SCODE",
    "SINCERITIES",
    "GRNBOOST2",
    "CELLORACLE",
    "JUMP3",
    "SCSGL",
    "GENIE3",
    "GRISLI",
    "GRNVBEM",
    "PIDC",
    "SCRIBE",
    "SINGE",
]

ALGORITHM_RUN_DIFFICULTY_RANK: dict[str, int] = {
    algorithm_id: index
    for index, algorithm_id in enumerate(ALGORITHM_RUN_DIFFICULTY_ORDER)
}


ALGORITHM_BY_ID: dict[str, AlgorithmInfo] = {
    algorithm["id"]: algorithm for algorithm in ALGORITHMS
}


def sort_algorithm_ids_by_difficulty(algorithm_ids: list[str]) -> list[str]:
    return [
        algorithm_id
        for _, algorithm_id in sorted(
            enumerate(algorithm_ids),
            key=lambda item: (
                ALGORITHM_RUN_DIFFICULTY_RANK.get(
                    item[1],
                    len(ALGORITHM_RUN_DIFFICULTY_RANK),
                ),
                item[0],
            ),
        )
    ]


def get_algorithms(
    *,
    include_inactive: bool = False,
    requires_pseudotime: bool | None = None,
) -> list[AlgorithmInfo]:
    items = ALGORITHMS

    if not include_inactive:
        items = [algorithm for algorithm in items if algorithm["active"]]

    if requires_pseudotime is not None:
        items = [
            algorithm
            for algorithm in items
            if algorithm["requires_pseudotime"] == requires_pseudotime
        ]

    return items


def get_algorithm_by_id(algorithm_id: str) -> AlgorithmInfo:
    normalized_id = algorithm_id.upper()

    if normalized_id not in ALGORITHM_BY_ID:
        raise KeyError(f"Unsupported algorithm: {algorithm_id}")

    return ALGORITHM_BY_ID[normalized_id]


def get_recommended_algorithms() -> list[AlgorithmInfo]:
    return [ALGORITHM_BY_ID[algorithm_id] for algorithm_id in RECOMMENDED_ALGORITHM_IDS]


_INT_VALUE_TYPES = {"int", "integer"}
_FLOAT_VALUE_TYPES = {"float", "number", "double"}
_BOOL_VALUE_TYPES = {"bool", "boolean"}
_BOOL_TRUE_STRINGS = {"true", "1", "yes", "on"}
_BOOL_FALSE_STRINGS = {"false", "0", "no", "off"}


def _coerce_parameter_value(parameter: AlgorithmParameter, value: Any) -> Any:
    """Coerce a raw submitted value to the parameter's declared value_type.

    Raises ValueError/TypeError on values that cannot be represented in the
    target type (callers translate these into a user-facing error).
    """
    value_type = str(parameter.get("value_type", "string")).lower()

    if value_type in _BOOL_VALUE_TYPES:
        if isinstance(value, bool):
            return value
        normalized = str(value).strip().lower()
        if normalized in _BOOL_TRUE_STRINGS:
            return True
        if normalized in _BOOL_FALSE_STRINGS:
            return False
        raise ValueError(f"expected a boolean, got {value!r}")

    if value_type in _INT_VALUE_TYPES:
        if isinstance(value, bool):
            raise ValueError(f"expected an integer, got {value!r}")
        if isinstance(value, float):
            if not value.is_integer():
                raise ValueError(f"expected an integer, got {value!r}")
            return int(value)
        if isinstance(value, int):
            return value
        text = str(value).strip()
        if not text:
            raise ValueError("expected an integer, got an empty value")
        return int(text)

    if value_type in _FLOAT_VALUE_TYPES:
        if isinstance(value, bool):
            raise ValueError(f"expected a number, got {value!r}")
        coerced = float(value)
        if coerced != coerced or coerced in {float("inf"), float("-inf")}:
            raise ValueError(f"expected a finite number, got {value!r}")
        return coerced

    return str(value)


def validate_algorithm_parameters(
    algorithm_id: str,
    raw_parameters: Any,
) -> dict[str, Any]:
    """Validate user-submitted parameter values for one algorithm.

    Values are checked against the registry declaration for ``algorithm_id``:
    unknown parameter names are rejected, values are coerced to the declared
    ``value_type``, ``options`` are enforced, and numeric bounds are enforced.
    Returns a cleaned name -> value dict
    suitable for persisting in the project manifest. ``None`` values (a param
    left at its default) are dropped. Raises ``ValueError`` on invalid input and
    ``KeyError`` when the algorithm id is unknown.
    """
    algorithm_info = get_algorithm_by_id(algorithm_id)
    spec = {
        parameter["name"]: parameter
        for parameter in algorithm_info.get("parameters", [])
        if parameter.get("name")
    }

    if raw_parameters is None:
        return {}
    if not isinstance(raw_parameters, dict):
        raise ValueError(
            f"Parameters for {algorithm_info['id']} must be an object."
        )

    cleaned: dict[str, Any] = {}
    for name, value in raw_parameters.items():
        if name not in spec:
            raise ValueError(
                f"Unknown parameter '{name}' for {algorithm_info['id']}."
            )
        if value is None:
            continue

        parameter = spec[name]
        try:
            coerced = _coerce_parameter_value(parameter, value)
        except (TypeError, ValueError):
            raise ValueError(
                f"Invalid value for {algorithm_info['id']}.{name}: {value!r}."
            )

        options = parameter.get("options")
        if options is not None and coerced not in options:
            raise ValueError(
                f"{algorithm_info['id']}.{name} must be one of {options}."
            )

        if isinstance(coerced, (int, float)) and not isinstance(coerced, bool):
            minimum = parameter.get("minimum")
            maximum = parameter.get("maximum")
            if minimum is not None and coerced < minimum:
                raise ValueError(
                    f"{algorithm_info['id']}.{name} must be at least {minimum}."
                )
            if maximum is not None and coerced > maximum:
                raise ValueError(
                    f"{algorithm_info['id']}.{name} must be at most {maximum}."
                )

        cleaned[name] = coerced

    return cleaned


def validate_selected_algorithm_parameters(
    selected_algorithm_ids: list[str],
    raw_parameters_by_algorithm: Any,
) -> dict[str, dict[str, Any]]:
    """Validate a {algorithm_id: {param: value}} map for the selected algorithms.

    Only entries whose algorithm is in ``selected_algorithm_ids`` are kept;
    parameters for unselected algorithms are ignored. Each entry is validated
    with :func:`validate_algorithm_parameters`. Algorithms with no submitted
    overrides are simply absent from the result.
    """
    if raw_parameters_by_algorithm is None:
        return {}
    if not isinstance(raw_parameters_by_algorithm, dict):
        raise ValueError("algorithm_parameters must be an object.")

    selected = {str(algorithm_id).upper() for algorithm_id in selected_algorithm_ids}
    cleaned: dict[str, dict[str, Any]] = {}
    for algorithm_id, raw in raw_parameters_by_algorithm.items():
        normalized_id = str(algorithm_id).upper()
        if normalized_id not in selected:
            continue
        try:
            validated = validate_algorithm_parameters(normalized_id, raw)
        except KeyError:
            raise ValueError(f"Unsupported algorithm: {algorithm_id}.")
        if validated:
            cleaned[normalized_id] = validated

    return cleaned


def resolve_algorithm_parameters(
    algorithm_id: str,
    overrides: Any = None,
) -> dict[str, Any]:
    """Return the complete parameter set for one algorithm.

    Registry defaults are copied first, then validated user overrides are
    applied. Required parameters without either a default or an override are
    rejected. The returned mapping is suitable for a durable job snapshot.
    """
    algorithm_info = get_algorithm_by_id(algorithm_id)
    validated_overrides = validate_algorithm_parameters(algorithm_id, overrides or {})
    resolved: dict[str, Any] = {}

    for parameter in algorithm_info.get("parameters", []):
        name = parameter.get("name")
        if not name:
            continue
        if name in validated_overrides:
            resolved[name] = validated_overrides[name]
            continue
        default = parameter.get("default")
        if default is not None:
            resolved[name] = default
            continue
        if parameter.get("required"):
            raise ValueError(
                f"{algorithm_info['id']}.{name} is required."
            )

    return resolved


def resolve_selected_algorithm_parameters(
    selected_algorithm_ids: list[str],
    overrides_by_algorithm: Any = None,
) -> dict[str, dict[str, Any]]:
    """Resolve complete parameter snapshots for all selected algorithms."""
    overrides = overrides_by_algorithm or {}
    if not isinstance(overrides, dict):
        raise ValueError("algorithm_parameters must be an object.")

    resolved: dict[str, dict[str, Any]] = {}
    for algorithm_id in selected_algorithm_ids:
        normalized_id = str(algorithm_id).upper()
        resolved[normalized_id] = resolve_algorithm_parameters(
            normalized_id,
            overrides.get(normalized_id, {}),
        )
    return resolved
