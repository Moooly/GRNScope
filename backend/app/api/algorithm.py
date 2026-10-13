

from fastapi import APIRouter

from app.algorithm_registry import get_algorithm_by_id, get_algorithms, get_recommended_algorithms
from app.api_contracts import AlgorithmResponse

router = APIRouter(prefix="/algorithms", tags=["algorithms"])


@router.get(
    "", response_model=list[AlgorithmResponse], response_model_exclude_unset=True
)
def list_algorithms(include_inactive: bool = False, requires_pseudotime: bool | None = None):
    return get_algorithms(
        include_inactive=include_inactive,
        requires_pseudotime=requires_pseudotime,
    )


@router.get(
    "/recommended",
    response_model=list[AlgorithmResponse],
    response_model_exclude_unset=True,
)
def list_recommended_algorithms():
    return get_recommended_algorithms()


@router.get(
    "/{algorithm_id}",
    response_model=AlgorithmResponse,
    response_model_exclude_unset=True,
)
def read_algorithm(algorithm_id: str):
    return get_algorithm_by_id(algorithm_id)
