"""Opt-in real inference and perturbation smoke test on disposable synthetic data.

Run from backend/: PYTHONPATH=. .venv/bin/python ../scripts/smoke-analysis.py
Requires local BEELINE, Docker, and the GENIE3/CellOracle images. Leaves its
runtime directory in the system temporary directory for diagnostic inspection.
"""
import asyncio
import inspect
import io
import json
import sys
import tempfile
import time
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import BackgroundTasks, Response, UploadFile
from starlette.requests import Request
from app.main import app
from app import config
from app.api import projects, results
from app.services import job_service, perturbation_service

root = Path(tempfile.mkdtemp(prefix='grnscope-release-smoke-'))
print(json.dumps({'runtime_directory': str(root)}), flush=True)
original = config.PROJECTS_ROOT
request = Request({'type':'http','method':'POST','path':'/api/projects/create-pending',
                   'headers':[(b'x-grnscope-client-id', b'qa_release_validation_20261101')]})
genes = ['GATA1','SPI1','KLF1','CEBPA','TAL1','LMO2','GATA2','MYB','RUNX1','CEBPB','IRF8','FLI1','STAT1','STAT3','HBB','HBA1','LYZ','MPO','ELANE','ITGAM','CD34','KIT','BCL11A','EPOR']
rng=np.random.default_rng(17)
latent=rng.uniform(0,5,(3,120))
expression=rng.poisson(np.vstack([2+latent[i%3]*(1+i%4) for i in range(len(genes))]))
lines=[','.join(['gene']+[f'cell-{i}' for i in range(120)])]
lines.extend(','.join([gene]+[str(v) for v in row]) for gene,row in zip(genes,expression))
content=('\n'.join(lines)+'\n').encode()

async def exercise():
    supplied=dict(project_name='Release smoke test (synthetic)', project_description='Disposable synthetic data',
        matrix_state='raw', dataset_species='human', enabled_gene_selection_stages='[]', include_known_tfs='false',
        selected_algorithms=json.dumps(['PEARSON','GENIE3','CELLORACLE']), ensemble_enabled='true',
        confidence_run_mode='fixed', confidence_bootstrap_runs='2', expression_filename='synthetic.csv',
        algorithm_parameters=json.dumps({'GENIE3':{'nEstimators':10},'CELLORACLE':{'maxCells':120,'pValueCutoff':1.0}}))
    kwargs={name: supplied.get(name, getattr(param.default,'default',param.default)) for name,param in inspect.signature(projects.create_pending_project).parameters.items() if name not in {'request','response'}}
    created=await projects.create_pending_project(request=request,response=Response(),**kwargs)
    if hasattr(created,'model_dump'): created=created.model_dump()
    print(json.dumps({'created':created}),flush=True)
    assert created['ok'],created
    project_id=created['project_id']; job_id=created['job_id']
    background=BackgroundTasks()
    uploaded=await projects.upload_project_dataset_and_start(project_id, background, request, Response(),
        expression_matrix=UploadFile(filename='synthetic.csv',file=io.BytesIO(content)),
        pseudotime=None,ground_truth=None,cluster_labels=None,gene_ordering=None,custom_tf_list=None)
    print(json.dumps({'upload':uploaded}),flush=True)
    assert uploaded['ok'],uploaded
    await background()
    project_dir=root/project_id
    started=time.monotonic(); previous=None
    while time.monotonic()-started < 900:
        manifest=json.loads((project_dir/'jobs.json').read_text())[-1]
        status=[(t['algorithm_id'],t['status'],t.get('progress_label'),t.get('error_message')) for t in manifest['tasks']]
        if status != previous:
            print(json.dumps({'seconds':round(time.monotonic()-started),'tasks':status}),flush=True);previous=status
        if all(t['status'] in job_service.TERMINAL_JOB_STATUSES for t in manifest['tasks']):break
        await asyncio.sleep(2)
    assert all(t['status']=='Completed' for t in manifest['tasks']),manifest
    counts={}
    for algorithm in ['PEARSON','GENIE3','CELLORACLE']:
        payload=await results.get_algorithm_result(project_id,algorithm,request,Response(),limit=0)
        assert payload['result']['top_edges'],algorithm
        counts[algorithm]=len(payload['result']['top_edges'])
    print(json.dumps({'fresh_inference_edges':counts}),flush=True)
    eligible=perturbation_service.eligible_perturbation_genes(project_dir)
    assert eligible,'No eligible perturbation genes'
    run=perturbation_service.create_perturbation_run(project_dir,gene=eligible[0],perturbation_value=0,n_propagation=3,clip_delta_x=True)
    print(json.dumps({'perturbation_gene':eligible[0],'run_id':run['run_id']}),flush=True)
    await asyncio.to_thread(perturbation_service.run_perturbation_task, project_id,run['run_id'])
    status=json.loads(perturbation_service.status_path(project_dir,run['run_id']).read_text())
    print(json.dumps({'perturbation_status':status}),flush=True)
    assert status['status']=='Completed',status
    result=perturbation_service.get_perturbation_result(project_dir,run['run_id'])
    assert result
    summary={'status':'passed','algorithms':counts,'perturbation_gene':eligible[0],'runtime_directory':str(root)}
    (root / 'smoke-summary.json').write_text(json.dumps(summary,indent=2))

with ExitStack() as stack:
    for name,module in list(sys.modules.items()):
        if name=='app' or name.startswith('app.'):
            if getattr(module,'PROJECTS_ROOT',None)==original:stack.enter_context(patch.object(module,'PROJECTS_ROOT',root))
    asyncio.run(exercise())
