from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import anndata
import numpy as np

from app.services.anndata_service import convert_h5ad_to_csv, inspect_h5ad_expression


class AnnDataServiceTests(unittest.TestCase):
    def test_inspects_matrices_and_converts_selected_layer(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_path = root / "expression.h5ad"
            destination_path = root / "expression.csv"
            data = np.array(
                [
                    [1.0, 2.0, 0.0],
                    [3.0, 4.0, 5.0],
                ]
            )
            adata = anndata.AnnData(
                X=data,
                obs={"cell_type": ["A", "B"]},
                var={"gene_symbol": ["Gene1", "Gene2", "Gene3"]},
            )
            adata.obs_names = ["cell_a", "cell_b"]
            adata.var_names = ["Gene1", "Gene2", "Gene3"]
            adata.layers["counts"] = data * 2
            adata.write_h5ad(source_path)

            inspection = inspect_h5ad_expression(source_path)
            conversion = convert_h5ad_to_csv(
                source_path=source_path,
                destination_path=destination_path,
                matrix_key="layer:counts",
            )

            self.assertEqual(inspection["format"], "h5ad")
            self.assertEqual(
                [matrix["key"] for matrix in inspection["matrices"]],
                ["X", "layer:counts"],
            )
            self.assertEqual(conversion["selected_matrix"], "layer:counts")
            self.assertEqual(conversion["gene_count"], 3)
            self.assertEqual(conversion["cell_count"], 2)
            self.assertEqual(
                destination_path.read_text(encoding="utf-8"),
                ",cell_a,cell_b\n"
                "Gene1,2.0,6.0\n"
                "Gene2,4.0,8.0\n"
                "Gene3,0.0,10.0\n",
            )


if __name__ == "__main__":
    unittest.main()
