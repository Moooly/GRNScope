from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..species_inference import infer_species_from_gene_names
from ..storage import save_upload_file
from ..services.anndata_service import inspect_h5ad_expression, is_h5ad_filename


router = APIRouter()


class SpeciesInferenceRequest(BaseModel):
    gene_names: list[str]


@router.post("/api/uploads/infer-species")
async def infer_uploaded_species(request: SpeciesInferenceRequest):
    if len(request.gene_names) > 100_000:
        raise HTTPException(
            status_code=400,
            detail="Too many gene identifiers were submitted for species detection.",
        )
    return {
        "ok": True,
        "inference": infer_species_from_gene_names(request.gene_names),
    }


@router.post("/api/uploads/inspect-expression")
async def inspect_expression_upload(expression_matrix: UploadFile = File(...)):
    filename = expression_matrix.filename or ""
    if not is_h5ad_filename(filename):
        return {
            "ok": False,
            "errors": ["Expression inspection accepts AnnData (.h5ad) files."],
        }

    with TemporaryDirectory(prefix="grnscope-h5ad-inspect-") as temporary_directory:
        source_path = Path(temporary_directory) / Path(filename).name
        try:
            save_upload_file(expression_matrix, source_path)
            inspection = inspect_h5ad_expression(source_path)
            return {"ok": True, **inspection}
        except Exception as exc:
            return {"ok": False, "errors": [str(exc)]}
