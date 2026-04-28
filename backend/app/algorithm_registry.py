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
]


class AlgorithmParameter(TypedDict, total=False):
    name: str
    label: str
    description: str
    default: Any
    required: bool
    value_type: str
    options: list[Any]


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
        "parameters": [],
    },
    {
        "id": "GRNBOOST2",
        "name": "GRNBoost2",
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
        "parameters": [],
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
            }
        ],
    },
    {
        "id": "PEARSON",
        "name": "Pearson",
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
                "label": "Latent dimension",
                "description": "Latent dimension used by SCODE.",
                "default": 10,
                "required": False,
                "value_type": "int",
            },
            {
                "name": "nIter",
                "label": "Number of iterations",
                "description": "Number of optimization iterations.",
                "default": 1000,
                "required": False,
                "value_type": "int",
            },
            {
                "name": "nRep",
                "label": "Number of repeats",
                "description": "Number of repeated SCODE runs.",
                "default": 6,
                "required": False,
                "value_type": "int",
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
        "estimated_runtime": "Fast to medium",
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
                "label": "Number of bins",
                "description": "Number of bins used by SINCERITIES.",
                "default": 10,
                "required": False,
                "value_type": "int",
            }
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
                "label": "Delay",
                "description": "Delay parameter used by SCRIBE.",
                "default": 5,
                "required": False,
                "value_type": "int",
            },
            {
                "name": "method",
                "label": "RDI method",
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
            },
            {
                "name": "expressionFamily",
                "label": "Expression family",
                "description": "Distribution family for expression values.",
                "default": "uninormal",
                "required": False,
                "value_type": "string",
                "options": ["uninormal", "negbinomial"],
            },
            {
                "name": "log",
                "label": "Log transform",
                "description": "Whether SCRIBE should log-transform expression values.",
                "default": False,
                "required": False,
                "value_type": "bool",
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
                "label": "Lambda",
                "description": "Regularization parameter.",
                "default": 0.01,
                "required": False,
                "value_type": "float",
            },
            {
                "name": "dT",
                "label": "Time step",
                "description": "Time-step parameter.",
                "default": 15,
                "required": False,
                "value_type": "int",
            },
            {
                "name": "num_lags",
                "label": "Number of lags",
                "description": "Number of lag values.",
                "default": 5,
                "required": False,
                "value_type": "int",
            },
            {
                "name": "kernel_width",
                "label": "Kernel width",
                "description": "Kernel width parameter.",
                "default": 0.5,
                "required": False,
                "value_type": "float",
            },
            {
                "name": "prob_zero_removal",
                "label": "Zero removal probability",
                "description": "Probability of zero removal.",
                "default": 0,
                "required": False,
                "value_type": "float",
            },
            {
                "name": "prob_remove_samples",
                "label": "Sample removal probability",
                "description": "Probability of removing samples.",
                "default": 0.0,
                "required": False,
                "value_type": "float",
            },
            {
                "name": "family",
                "label": "Expression family",
                "description": "Expression family used by SINGE.",
                "default": "gaussian",
                "required": False,
                "value_type": "string",
            },
            {
                "name": "num_replicates",
                "label": "Number of replicates",
                "description": "Number of SINGE replicates.",
                "default": 6,
                "required": False,
                "value_type": "int",
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
        "estimated_runtime": "Medium to slow",
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
            },
            {
                "name": "R",
                "label": "R",
                "description": "GRISLI R parameter.",
                "default": 3000,
                "required": False,
                "value_type": "int",
            },
            {
                "name": "alphaMin",
                "label": "Minimum alpha",
                "description": "Minimum alpha value.",
                "default": 0.0,
                "required": False,
                "value_type": "float",
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
        "estimated_runtime": "Medium to slow",
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
        "name": "Jump3",
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
        "active": True,
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
        "name": "scSGL",
        "description": "Kernelized signed graph-learning method for single-cell GRN inference.",
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
        "active": True,
        "recommended": False,
        "estimated_runtime": "Medium",
        "strengths": [
            "Learns signed networks with positive and negative regulatory associations.",
            "Designed for single-cell expression data.",
            "Kernelized version accounts for non-linear co-expression and frequent zero values.",
        ],
        "limitations": [
            "Edges are not directed in this registry.",
            "Not one of the 12 algorithms evaluated in the original BEELINE paper.",
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


ALGORITHM_BY_ID: dict[str, AlgorithmInfo] = {
    algorithm["id"]: algorithm for algorithm in ALGORITHMS
}


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